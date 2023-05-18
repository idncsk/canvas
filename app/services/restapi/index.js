'use strict'


/**
 * Simple express.js JSON Rest API server
 */

// Utils
const debug = require('debug')('canvas-svc-restapi')

// Config
const config = require('../../../config/jsonapi-server.json')

// Canvas service "interface"
const Service = require('../../models/Service');

// Services
const express = require('express');
const bodyParser = require('body-parser');

//Routes
const contextRoutes = require('./routes/context');
const documentsRoutes = require('./routes/documents');
//const indexRoutes = require('./routes/index');

// Constants, to be moved to config
const DEFAULT_PROTOCOL = config.protocol || 'http'
const DEFAULT_HOST = config.host || '127.0.0.1'
const DEFAULT_PORT = config.port || 3000
const API_KEY = config.key || 'canvas-service-restapi';

// Middleware function to validate the API key
const validateApiKey = (req, res, next) => {
    const receivedApiKey = req.get('API-KEY');
    if (receivedApiKey === API_KEY) {
        next();
    } else {
        console.log(`Unauthorized: Invalid API Key: ${receivedApiKey}`)
        res.status(401).send('Unauthorized: Invalid API Key');
    }
};

class ExpressService extends Service {

    constructor(options = {}) {
        super(options);

        this.server = null;

        this.context = options.context;
        this.index = options.index;

        this.options.protocol = options.protocol || DEFAULT_PROTOCOL;
        this.options.host = options.host || DEFAULT_HOST;
        this.options.port = options.port || DEFAULT_PORT;
    }

    async start() {
        this.server = express();

        this.server.use(bodyParser.json());
        this.server.use(validateApiKey);

        this.server.use('/context', (req, res, next) => {
            req.context = this.context;
            next();
        }, contextRoutes);

        this.server.use('/documents', (req, res, next) => {
            req.context = this.context;
            req.index = this.index;
            next();
        }, documentsRoutes);

        await new Promise((resolve, reject) => {
            this.server.listen(this.options.port, resolve).on('error', reject);
        });

        console.log(`REST API listening at ${this.options.protocol}://${this.options.host}:${this.options.port}`);
        super.start();
    }

    async stop() {
        if (this.server) {
            await new Promise((resolve, reject) => {
                this.server.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });

            this.server = null;
            super.stop();
        }
    }

    async restart() {
        if (this.isRunning()) {
            await this.stop();
            await this.start();
        }
    }
}

module.exports = ExpressService;


/*
let server = null
let currentOptions = null;

exports.start = (context, index, options = {
    protocol: DEFAULT_PROTOCOL,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT
}) => {

    // Create an express.js server
    currentOptions = options;
    server = express();

    // Use body-parser middleware to parse JSON request bodies
    server.use(bodyParser.json());

    // Use the validateApiKey middleware for all routes
    server.use(validateApiKey);

    // Use the imported route files as middleware
    server.use('/context', (req, res, next) => {
        req.context = context;
        next();
    }, contextRoutes);

    server.use('/document', (req, res, next) => {
        req.context = context;
        req.index = index;
        next();
    }, documentRoutes);

    server.use('/documents', (req, res, next) => {
        req.context = context;
        req.index = index;
        next();
    }, documentsRoutes);

    // Start the server
    server.listen(options.port, () => {
        console.log(`JSON API listening at ${options.protocol}://${options.host}:${options.port}`);
    });

}

exports.stop = () => {
    if (server) {
        server.close();
        server = null;
    }
}

exports.restart = () => {
    if (server) { exports.stop(); }
    // TODO: Fix me
    exports.start(currentContext, currentIndex, currentOptions);
}

exports.status = () => {
    return {
        protocol: currentOptions.protocol,
        host: currentOptions.host,
        port: currentOptions.port,
        listening: server ? true : false
    }
}

*/
