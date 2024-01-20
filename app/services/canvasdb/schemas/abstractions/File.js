/**
 * Data abstraction to store File metadata
 */

const Document = require('../Document')
const DOCUMENT_SCHEMA_VERSION = '2.0'
const DOCUMENT_SCHEMA_TYPE = 'data/abstraction/file';

class File extends Document {

    constructor() {}

    static toJSON() {

        // Get base document as JSON
        let base = super.toJSON();

        // Set schema version and type
        base.schemaVersion = DOCUMENT_SCHEMA_VERSION;
        base.type = DOCUMENT_SCHEMA_TYPE;

        return base;
    }

}

module.exports = File;