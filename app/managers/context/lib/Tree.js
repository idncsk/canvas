'use strict'



// Utils
const EventEmitter = require('eventemitter2')
const debug = require('debug')('cotext-tree')
const path = require('path')
const os = require('os')

// Constants
const DEFAULT_USERDATA_PATH = path.join(os.homedir(), '.canvas')

// App modules
const Layer = require('./Layer')
const LayerIndex = require('./LayerIndex')
const TreeIndex = require('./TreeIndex')

// Default root layer
const rootLayer = new Layer({
    id: '/',
    name: 'universe',
    label: 'universe',
    type: 'universe',
    description: 'And then there was light',
    color: '#fff',
    contextBitmaps: ['universe']
})


/**
 * TreeNode class
 */

class TreeNode {

    constructor(id, payload) {

        if (!id) throw new Error('Treenode ID not provided')
        if (typeof id !== 'string') throw new Error(`TreeNode ID must be of type string, "${typeof id}" given`)

        if (!payload) throw new Error('TreeNode payload must be provided')
        if (typeof payload !== 'object') throw new Error(`TreeNode payload must be of type object, "${typeof payload}" given`)

        this.id = id;
        this.payload = payload;
        this.children = new Map();
    }

    get isLeaf() { return this.children.size === 0; }
    get hasChildren() { return !this.isLeaf; }
    get name() { return this.payload.name; }

    getChild(id) { return this.children.get(id); }

    hasChild(id) { return this.children.has(id); }

    addChild(child) {
        if (!(child instanceof TreeNode)) {
            throw new Error(`Child must be an instance of TreeNode, "${typeof child}" given`);
        }

        if (!this.hasChild(child.id)) this.children.set(child.id, child);
        return true

    }

    removeChild(id) { return this.children.delete(id); }

}


/**
 * Tree class
 * @extends EventEmitter
 */

class Tree extends EventEmitter {

    #layers;
    #index;

    constructor(layerIndex, treeIndex) {

        // Initialize the event emittter
        super()

        // Create the root node
        this.root = new TreeNode('/', rootLayer)

        // Initialize indexes
        this.#layers = (typeof layerIndex === 'object') ? layerIndex : new LayerIndex(path.join(DEFAULT_USERDATA_PATH, 'layerIndex.json'))
        this.#index = (typeof treeIndex === 'object') ? treeIndex : new TreeIndex(path.join(DEFAULT_USERDATA_PATH, 'treeIndex.json'))

        // Load tree from the database
        if (this.load()) {
            debug('Context tree loaded from database')
        } else {
            debug('Context tree not found in database, using vanilla root node')
        }

        // Emit the ready event
        debug('Context tree initialized')
        debug(JSON.stringify(this.#buildJsonTree(), null, 2))
        this.emit('ready')

    }

    /**
     * Getters
     */

    get paths() { return this.#buildPathArray(); }


    /**
     * Tree interface methods
     */

    // insert
    // remove
    // copy
    // move
    // rename

    insert(path = '/', node, autoCreateLayers = true) {

        debug(`Inserting path "${path}" to the context tree`)
        if (path === '/' && !node) {
            debug('Nothing to insert')
            return false
        }

        let currentNode = this.root;
        let child

        const layerNames = path.split('/').filter(Boolean);
        for (const layerName of layerNames) {

            let layer = this.#layers.getLayerByName(layerName)
            if (!layer) {
                if (autoCreateLayers) {
                    layer = this.#layers.createLayer(layerName)
                } else {
                    debug(`Layer "${layerName}" not found at path "${path}"`)
                    return false
                }
            }

            child = currentNode.getChild(layer.id);
            if (!child) {
                child = new TreeNode(layer.id, this.#layers.getLayerByID(layer.id))
                currentNode.addChild(child)
            }

            currentNode = child;
        }

        if (node) {
            // Check if node already exists
            child = currentNode.getChild(node.id);
            if (child && child instanceof TreeNode) {
                // Add node to parent
                currentNode.addChild(child)
            }
        }

        // Commit changes
        this.save()

    }

    move(pathFrom, pathTo, recursive = false) {

        if (recursive) return this.moveRecursive(pathFrom, pathTo)
        debug(`Moving layer from "${pathFrom}" to "${pathTo}"`)

        const node = this.getNode(pathFrom);
        if (!node) {
            debug('Unable to move layer, source node not found')
            return false;
        }

        const parentPath = pathFrom.split('/').slice(0, -1).join('/');
        const parentNode = this.getNode(parentPath);
        if (!parentNode) { return false; }

        let layer = node.payload
        let targetNode = new TreeNode(layer.id, layer)

        if (!this.insert(pathTo, targetNode)) {
            console.log(`Unable to move layer "${layer.name}" to path "${pathTo}"`)
            return false
        }

        // Remove existing node from parent
        parentNode.removeChild(node.id)

        // Move all node children to parent
        if (node.hasChildren) {
            for (const [key, value] of node.children.values()) {
                //parentNode.children.set(key, value);
                parentNode.addChild(value);
            }
        }

        // Commit changes
        this.save()

    }

    moveRecursive(pathFrom, pathTo) {

        debug(`Moving layer from "${pathFrom}" to "${pathTo}" recursively`)
        const node = this.getNode(pathFrom);
        const parentPath = pathFrom.split('/').slice(0, -1).join('/');
        const parentNode = this.getNode(parentPath);
        const layer = node.payload

        if (pathTo.includes(layer.name)) {
            throw new Error(`Destination path "${pathTo}" includes "${layer.name}"`)
        }

        if (!this.insert(pathTo, node)) {
            console.log(`Unable to move layer "${layer.name}" into path "${pathTo}"`)
            return false
        }

        // Remove existing node from parent
        parentNode.removeChild(node.id)

        // Commit changes
        this.save()

    }

    copy(pathFrom, pathTo, recursive) {

        // Commit changes
        this.save()
    }

    copyRecursive(pathFrom, pathTo) {

        // Commit changes
        this.save()
    }

    remove(path, recursive = false) {

        const node = this.getNode(path);
        if (!node) {
            debug(`Unable to remove layer, source node not found at path "${path}"`)
            return false;
        }

        const parentPath = path.split('/').slice(0, -1).join('/');
        const parentNode = this.getNode(parentPath);
        if (!parentNode) throw new Error(`Unable to remove layer, parent node not found at path "${parentPath}"`)

        if (!recursive && node.hasChildren) {
            // Merge all node children to parent
            for (const [key, value] of node.children.values()) {
                parentNode.addChild(value);
            }
        }

        // Remove existing node from parent
        parentNode.removeChild(node.id)

        // Commit changes
        this.save()
        return true
    }

    renameLayer(name, newName) {
        return this.#layers.renameLayer(name, newName)
    }

    // Store tree as JSON to the database
    save() {
        debug('Saving current in-memory tree to database')
        let data = this.#buildJsonIndexTree()
        this.#index.set('tree', data)//if (!this.#index.set('tree', data)) throw new Error('Unable to save tree to database')
        return true
    }

    // Load JSON tree from the database
    load(json = this.#index.get('tree')) {
        debug('Loading JSON data from database')
        if (!json) {
            debug('No persistent JSON data found')
            return false
            throw new Error('No JSON data supplied')
        }
        this.root = this.#buildTreeFromJson(json)
        return true
    }

    /**
     * Legacy methods
     */

    fromJSON(json) { return this.load(json); }
    toJSON() { return this.#buildJsonTree(); }
    getJsonIndexTree() { return this.#buildJsonIndexTree(); }
    getJsonTree() { return this.#buildJsonTree(); }
    loadJsonTree(json) { return this.#buildTreeFromJson(json); }
    clear() {
        debug('Clearing context tree')
        this.root = new TreeNode('/', rootLayer);
        this.save()
    }


    /**
     * Tree node methods
     */

    getNode(path) {

        if (path === '/' || !path) return this.root

        const layerNames = path.split('/').filter(Boolean);
        let currentNode = this.root;

        for (const layerName of layerNames) {
            let layer = this.#layers.getLayerByName(layerName)
            if (!layer) {
                debug(`Layer "${layerName}" not found in index`)
                return false
            }

            let child = currentNode.getChild(layer.id);
            if (!child) {
                debug(`Target path "${path}" does not exist`)
                return false
            }

            currentNode = child;
        }

        return currentNode;
    }

    insertNode(path, node) {

        const targetNode = this.getNode(path);
        if (!targetNode) {
            debug(`Unable to insert node at path "${path}", target node not found`)
            return false;
        }

        if (!node || !node instanceof TreeNode) {
            debug('Unable to move layer, source node not found')
            return false;
        }

        // Check if node already exists
        if (!targetNode.hasChild(node.id)) {
            targetNode.addChild(node)
        }

        //this.emit('insert', path, node)
        this.save()
        return true;

    }

    removeNode(path, recursive = false) {
        const node = this.getNode(path);
        if (!node) {
            debug(`Unable to remove layer, source node not found at path "${path}"`)
            return false;
        }

        const parentPath = path.split('/').slice(0, -1).join('/');
        const parentNode = this.getNode(parentPath);
        if (!parentNode) throw new Error(`Unable to remove layer, parent node not found at path "${parentPath}"`)

        if (!recursive && node.hasChildren) {
            // Merge all node children to parent
            for (const [key, value] of node.children.values()) {
                parentNode.addChild(value);
            }
        }

        // Remove existing node from parent
        parentNode.removeChild(node.id)

        // Commit changes
        this.save()
        return true
    }

    moveNode(pathFrom, pathTo, recursive = false) { }

    moveNodeRecursive(pathFrom, pathTo) { }


    /**
     * Internal methods
     */

    #buildTreeFromJson(rootNode, autoCreateLayers = true) {

        // Return an empty
        if (!rootNode) { return new TreeNode('/', rootLayer); }

        const buildTree = (nodeData) => {

            let node;
            let layer;

            layer = (nodeData.id === '/' || nodeData.name === '/') ?  rootLayer : this.#layers.getLayerByID(nodeData.id);
            if ((!layer && !nodeData.name) || (!layer && !autoCreateLayers)) {
                throw new Error(`Unable to find layer by ID "${nodeData.id}", can not create a tree node`);
            }

            if (!layer && autoCreateLayers) {
                console.log('Not here')
                layer = this.#layers.createLayer(nodeData.name);
            }

            if (layer.id === '/') {
                node = new TreeNode('/', rootLayer)
            } else {
                node = new TreeNode(layer.id, this.#layers.getLayerByID(layer.id));
            }

            for (const childData of nodeData.children) {
                const childNode = buildTree(childData);
                node.addChild(childNode);
            }

            return node;
        };

        return buildTree(rootNode);
    }


    #buildJsonIndexTree(node = this.root) {
        const buildTree = (currentNode) => {
            const children = Array.from(currentNode.children.values())
                .filter(child => child instanceof TreeNode)
                .map(child => child.hasChildren ? buildTree(child) : {
                    id: child.id,
                    children: []
                });

            return {
                id: currentNode.id,
                children: children,
            };
        };

        return buildTree(node);
    }

    #buildJsonTree(node = this.root) {
        const buildTree = (currentNode) => {
            const children = Array.from(currentNode.children.values())
                .filter(child => child instanceof TreeNode)
                .map(child => child.hasChildren ? buildTree(child) : createLayerInfo(child.payload));

            return createLayerInfo(this.#layers.getLayerByID(currentNode.id) || rootLayer, children);
        };

        const createLayerInfo = (payload, children = []) => ({
            // id: payload.id, Removing ID from the tree due to jstree rendering issues
            name: payload.name,
            text: payload.name, // Compatibility with jstree
            label: payload.label,
            description: payload.description,
            color: payload.color,
            children
        });

        return buildTree(node);
    }

    #parseJson(json = '{}') {
        try {
            return JSON.parse(json);
        } catch (err) {
            throw new SyntaxError(`Invalid JSON data: ${err.message}`);
        }
    }

    #buildPathArray(sort = true) {
        const paths = [];

        const traverseTree = (node, parentPath = '') => {
          const path = (node.name === 'universe') ?
            parentPath :
            parentPath + '/' + node.name;

          if (node.children.size > 0) {
            for (const child of node.children.values()) {
              traverseTree(child, path);
            }
          } else {
            paths.push(path);
          }
        };

        traverseTree(this.root);
        return sort ? paths.sort() : paths;
      }

}

module.exports = Tree