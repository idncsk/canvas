/**
 * Canvas IndexD
 */


// Utils
const debug = require('debug')('canvas-index')
const EE = require('eventemitter2')

// Database
const Db = require('../db')

// App includes
const BitmapManager = require('./lib/BitmapManager')

// Constants
const MAX_DOCUMENTS = 4294967296 // 2^32
const MAX_CONTEXTS = 1024 // 2^10
const MAX_FEATURES = 65536 // 2^16
const MAX_FILTERS = 65536 // 2^16
const INTERNAL_BITMAP_ID_MIN = 1000
const INTERNAL_BITMAP_ID_MAX = 1000000

// Metadata document schemas
const Document = require('../../schemas/Document');
const DOCUMENT_SCHEMAS = {
    // Generic document schema
    default: require('../../schemas/Document').toJSON(),
    // Data abstraction schemas
    file: require('../../schemas/abstr/File').toJSON(),
    tab: require('../../schemas/abstr/Tab').toJSON(),
    note: require('../../schemas/abstr/Note').toJSON()
}


/**
 * Canvas IndexD
 */

class IndexD extends EE {


    #db
    #epoch = "e0"   // 2^32 bitmap limit

    constructor(options = {}) {


        debug('Initializing Canvas Index')

        // Initialize event emitter
        super({
            wildcard: true,         // set this to `true` to use wildcards
            delimiter: '/',         // the delimiter used to segment namespaces
            newListener: true,      // set this to `true` if you want to emit the newListener event
            removeListener: true,   // set this to `true` if you want to emit the removeListener event
            maxListeners: 32,       // the maximum amount of listeners that can be assigned to an event
            verboseMemoryLeak: false,   // show event name in memory leak message when
                                        // more than maximum amount of listeners is assigned
            ignoreErrors: false     // disable throwing uncaughtException if an error event is emitted
                                    //and it has no listeners
        })

        // Initialize database
        if (options.db) { this.db = options.db; } else {
            // Validate options
            if (!options.path) throw new Error('Database path is required')

            // Initialize the database backend
            this.db = new Db({
                path: options.path,
                maxDbs: options.maxDbs || 32
            })
        }

        // Document dataset
        this.documents = this.db.createDataset('documents')

        // Bitmaps
        this.bitmaps = this.db.createDataset('bitmaps')

        // HashMap(s)
        // To decide whether to use a single dataset
        // sha1/<hash> | oid
        // md5/<hash> | oid
        // or a separate dataset per hash type
        this.hash2oid = this.db.createDataset('hash2oid')

        // Internal Bitmaps
        this.bmInternal = new BitmapManager(this.bitmaps, 'internal', {
            min: INTERNAL_BITMAP_ID_MIN,
            max: INTERNAL_BITMAP_ID_MAX
        })

        // Contexts
        this.bmContexts = new BitmapManager(this.bitmaps, 'contexts', {
            min: INTERNAL_BITMAP_ID_MAX,
        })

        // Features
        this.bmFeatures = new BitmapManager(this.bitmaps, 'features', {
            min: INTERNAL_BITMAP_ID_MAX,
        })

        // Filters
        this.bmFilters = new BitmapManager(this.bitmaps, 'filters', {
            min: INTERNAL_BITMAP_ID_MAX,
        })

        // Queues
        // TODO

        // Timeline
        // <timestamp> | <action> | diff {path: [bitmap IDs]}
        // Action: create, update, delete
        // TODO

    }


    /**
     * Document management
     */

    async insertDocument(doc, contextArray = [], featureArray = []) {
        debug('insertDocument()', doc, contextArray, featureArray)

        // Validate
        let parsed = this.#validateDocument(doc)
        debug('Document validated', parsed)

        // Extract features
        let extractedFeatures = this.#extractDocumentFeatures(parsed)
        let combinedFeatureArray = [...featureArray, ...extractedFeatures]
        debug('Document feature array', combinedFeatureArray)

        // Update existing document if already present
        let res = await this.hash2oid.get(parsed.hashes.sha1)
        if (res) {
            debug('Document already present, updating..')
            return this.updateDocument(parsed, contextArray, combinedFeatureArray)
        }

        try {
            // Update bitmaps and documents in parallel
            let updateBitmapsAndDocs = Promise.all([
                this.documents.put(parsed.id, parsed),
                this.bmContexts.tickMany(contextArray, parsed.id),
                this.bmFeatures.tickMany(combinedFeatureArray, parsed.id)
            ]);

            await updateBitmapsAndDocs;

            // Final step: update hash2oid
            await this.hash2oid.put(parsed.hashes.sha1, parsed.id);
            debug('Document insert and indexes update complete');

            // Return the parsed document, id, meta + bling-bling included
            return parsed;

        } catch (error) {
            debug('Error during document insert:', error);
            // TODO: Implement a rollback for bitmap updates, maybe split this
            // method into separate methods for document insert and bitmap updates
            throw error;
        }
    }

    getDocument(id) { return this.documents.get(id); }

    getDocumentByHash(hash, hashType = '') {
        if (typeof hash !== 'string') { throw new TypeError('Hash must be a string'); }
        if (hashType && typeof hashType !== 'string') { throw new TypeError('Hash type must be a string'); }

        let fullHash = hashType ? `${hashType}/${hash}` : hash;

        let id = this.hash2oid.get(fullHash);
        if (!id) return null;

        return this.documents.get(id);
    }

    async getDocuments(ids = [], cb = null) {
        if (!Array.isArray(ids)) { throw new TypeError('IDs must be an array'); }

        try {
            const res = await this.documents.getMany(ids);
            if (cb) { cb(null, res); }
            return res;
        } catch (err) {
            if (cb) { cb(err); } else { throw err; }
        }
    }

    listDocuments(contextArray = [], featureArray = []) {

        debug('listDocuments()', contextArray, featureArray)
        let documents = []

        if (!contextArray.length && !featureArray.length) {
            documents = this.documents.listValues()
            return documents
        }

        /*
        let calculatedContextBitmap = this.contextBitmaps.addMany(contextArray)
        debug('Context IDs', calculatedContextBitmap)

        let calculatedFeatureBitmap = this.featureBitmaps.addMany(featureArray)
        debug('Feature IDs', calculatedFeatureBitmap)

        let result = BitmapManager.addBitmaps([calculatedContextBitmap, calculatedFeatureBitmap])
        debug('Result IDs', result.toArray())

        documents = await this.documents.getMany(result.toArray())
        debug('Documents', documents)

        return documents*/
    }

    async updateDocument(doc, contextArray = [], featureArray = []) {
        return true
    }

    async removeDocument(doc) {

    }

    async removeDocumentByID(id) {

    }

    async removeDocumentByHash(hash) {

    }



    /**
     * Feature management
     */

    async createFeature(feature) {}

    async hasFeature(feature) {}

    async getFeature(feature) {}

    async removeFeature(feature) {}

    async getFeatureStats(feature) {}

    async listFeatures() { return this.bmFeatures.list(); }

    async tickFeatures(featureArray, id) {
        this.#tickFeatureArrayBitmaps(featureArray, id)
    }

    async untickFeatures(featureArray, id) {

    }


    /**
     * Schema management
     */

    listDocumentSchemas() { return DOCUMENT_SCHEMAS; }

    hasDocumentSchema(schema) { return DOCUMENT_SCHEMAS[schema] ? true : false; }

    getDocumentSchema(schema) {
        // TODO: Rework (this ugly workaround [for inconsistent schema names])
        if (schema.includes('/')) schema = schema.split('/').pop()
        if (!DOCUMENT_SCHEMAS[schema]) return null
        return DOCUMENT_SCHEMAS[schema]
    }


    /**
     * Filter management
     */

    // Regexp
    // Timeline
    // Metadata


    /**
     * Internal methods
     */

    #validateDocument(doc, schema = DOCUMENT_SCHEMAS['default']) {
        if (typeof doc !== 'object') throw new Error('Document is not an object')
        if (!doc.id) doc.id = this.#genDocumentID()

        // This part needs some love

        let initialized = new Document(doc)
        return initialized
    }

    #genDocumentID() {
        let id = this.db.getKeysCount() + 1000
        return id++
    }

    #extractDocumentFeatures(doc) {
        let features = []
        return features
    }

    #tickContextArrayBitmapsSync(bitmapIdArray = [], id) {
        for (const context of bitmapIdArray) {
            debug(`Updating bitmap for context ID "${context}"`);
            //this.contextBitmaps.tick(context, id);
        }
    }

    #tickFeatureArrayBitmapsSync(bitmapIdArray = [], id) {
        for (const feature of bitmapIdArray) {
            debug(`Updating bitmap for feature ID "${feature}"`)
            //this.featureBitmaps.tick(feature, id)
        }
    }

    async #tickContextArrayBitmaps(bitmapIdArray = [], id) {
        for (const context of bitmapIdArray) {
            debug(`Updating bitmap for context ID "${context}"`);
            await this.contextBitmaps.tick(context, id);
        }
    }

    async #tickFeatureArrayBitmaps(bitmapIdArray = [], id) {
        for (const feature of bitmapIdArray) {
            debug(`Updating bitmap for feature ID "${feature}"`)
            await this.featureBitmaps.tick(feature, id)
        }
    }

}

module.exports = IndexD
