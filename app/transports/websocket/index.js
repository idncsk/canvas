// Canvas service "interface"
const Service = require('../../managers/service/lib/Service');

// Utils
const debug = require('debug')('canvas-svc-websocket')
const http = require('http');
const io = require('socket.io')

// Defaults
const DEFAULT_PROTOCOL = 'http'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3001
const API_KEY = 'canvas-socketio';

class SocketIoService extends Service {

    #protocol;
    #host;
    #port;

    constructor(options = {}) {
        super(options);
        this.server = null;

        this.#protocol = options.protocol || DEFAULT_PROTOCOL;
        this.#host = options.host || DEFAULT_HOST;
        this.#port = options.port || DEFAULT_PORT;

        // TODO: Refactor!!!!! (this is a ugly workaround)
        if (!options.context) throw new Error('Context not defined');
        this.context = options.context;
    }

    async start() {
        const server = http.createServer();
        this.server = io(server);

        server.listen(this.#port, () => { // Listen on the specified port
            console.log("Socket.io Server listening on Port", this.#port);
            this.status = 'running';
        }).on('error', (err) => {
            console.error("Error in server setup:", err);
        });

        this.server.on('connection', (socket) => {
            console.log(`Client connected: ${socket.id}`);

            // Setup event listeners
            setupSocketEventListeners(socket, this.context);
            setupDataEventListeners(socket, this.context);
            setupContextEventListeners(socket, this.context);

            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
            });
        });
    }


    async stop() {
        if(this.server) {
            this.server.close();
            this.server = null;
        }
        this.status = 'stopped';
    }

    async restart(context, index) {
        await this.stop();
        await this.start(context, index);
    }

    status() {
        if (!this.server) { return { listening: false }; }

        let clientsCount = 0;
        for (const [id, socket] of this.server.sockets.sockets) {
            if (socket.connected) {
                clientsCount++;
            }
        }

        return {
            protocol: this.#protocol,
            host: this.#host,
            port: this.#port,
            listening: true,
            connectedClients: clientsCount
        };
    }

}

module.exports = SocketIoService;


/**
 * Functions
 */

function setupSocketEventListeners(socket, context) {

    // Setters::Context
    socket.on('context:set:url', (data) => {
        debug('Context:set:url event')
        context.url = data.url;
    });

    socket.on('context:insert:path', (path) => {
        debug(`context:insert:path event with path "${path}"`)
        context.insertPath(path, true)
    })

    socket.on('context:remove:path', (path) => {
        debug(`context:remove:path event with path "${path}"`)
        context.removePath(path)
    })

    socket.on('context:move:path', (pathFrom, pathTo, recursive) => {
        debug(`context:move:path event with parms "${pathFrom}" -> "${pathTo}", recursive: ${recursive}`)
        context.movePath(pathFrom, pathTo, recursive)
    })


    // Getters::Context
    socket.on('context:get:stats', (data, callback) => {
        debug('Context:get:stats event')
        callback(context.stats());
    });

    socket.on('context:get:url', (data, callback) => {
        debug('Context:get:url event')
        callback(context.url);
    });

    socket.on('context:get:path', (data, callback) => {
        debug('Context:get:path event')
        callback(context.path);
    });

    socket.on('context:get:array', (data, callback) => {
        debug('Context:get:array event')
        callback(context.array);
    });

    socket.on('context:get:tree', (data, callback) => {
        debug('Context:get:tree event')
        callback(context.tree);
    });

    socket.on('context:get:contextArray', (data, callback) => {
        debug('Context:get:contextArray event')
        callback(context.contextArray);
    });

    socket.on('context:get:featureArray', (data, callback) => {
        debug('Context:get:featureArray event')
        callback(context.featureArray);
    });

    socket.on('context:get:filterArray', (data, callback) => {
        debug('Context:get:filterArray event')
        callback(context.filterArray);
    });

}

function setupDataEventListeners(socket, context) {

    // Setters::Index
    socket.on('test123', async (doc, callback) => {
        debug('index:insertDocument event')
        try {
            await context.insertDocument(doc);
            callback({ status: 'success', message: 'Document inserted successfully.' });
        } catch (error) {
            console.error(error)
            callback({ status: 'error', message: `Error inserting document: ${error.message}` });
        }
    })

    socket.on('index:insertDocumentArray', async (docArray, callback) => {
        debug('index:insertDocumentArray event')
        try {
            await context.insertDocumentArray(docArray);
            callback({ status: 'success', message: 'Document inserted successfully.' });
        } catch (error) {
            callback({ status: 'error', message: `Error inserting document: ${error.message}` });
        }
    })


    socket.on('index:updateDocument', async (doc, callback) => {
        debug('index:updateDocument event')
        try {
            await context.updateDocument(doc);
            callback({ status: 'success', message: 'Document updated successfully.' });
        } catch (error) {
            callback({ status: 'error', message: `Error updating document: ${error.message}` });
        }
    })

    socket.on('index:removeDocument', async (doc, callback) => {
        debug('index:removeDocument event')
        try {
            await context.removeDocument(doc);
            callback({ status: 'success', message: 'Document removed successfully.' });
        } catch (error) {
            callback({ status: 'error', message: `Error removed document: ${error.message}` });
        }
    })

    socket.on('index:schema:get', async (data, callback) => {
        debug('index:schema:get event')
        const schema = context.getDocumentSchema(data.type, data.version);
        if (!schema) {
            let msg = `Schema not found for type "${data.type}" and version "${data.version}"`;
            callback({ status: 'error', message: msg });
            return;
        }
        callback(schema);

    })


}

function setupContextEventListeners(socket, context) {

    context.on('url', (url) => {
        debug('context:url event')
        socket.emit('context:url', url);
    })

}
