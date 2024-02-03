'use strict'

const RoaringBitmap32 = require('roaring/RoaringBitmap32')
const Bitmap = require('./Bitmap')
const debug = require('debug')('canvasdb:bitmapManager')


class BitmapManager {

    #db;
    #cache;

    /**
     * BitmapManager constructor
     *
     * @param {*} db
     * @param {*} cache
     * @param {*} options
     */
    constructor(db = new Map(), cache = new Map(), options = {
        rangeMin: 0,
        rangeMax: 4294967296 // 2^32
    }) {
        // A suitable DB backend with a Map() like interface
        this.#db = db
        // A suitable Caching backend with a Map() like interface
        this.#cache = cache

        // This should probably be implemented one abstraction layer up
        this.rangeMin = options.rangeMin
        this.rangeMax = options.rangeMax

        debug(`BitmapManager initialized with rangeMin: ${this.rangeMin}, rangeMax: ${this.rangeMax}`)
    }


    /**
     * Bitmap management
     */

    createBitmap(key, oidArrayOrBitmap = null) {
        if (this.hasBitmap(key)) {
            debug(`Bitmap with key ID "${key}" already exists`);
            return false;
        }

        let bitmap;
        if (!oidArrayOrBitmap) {
            debug(`Creating new empty bitmap with key ID "${key}"`);
            bitmap = new RoaringBitmap32();
        } else if (oidArrayOrBitmap instanceof RoaringBitmap32) {
            debug(`Storing bitmap under new key ID "${key}"`);
            bitmap = oidArrayOrBitmap;
        } else if (Array.isArray(oidArrayOrBitmap)) {
            debug(`Creating new bitmap with key ID "${key}" and ${oidArrayOrBitmap.length} elements`);
            bitmap = new RoaringBitmap32(oidArrayOrBitmap);
        } else {
            debug(`Invalid input for bitmap with key ID "${key}"`);
            return false;
        }

        bitmap = Bitmap.create(oidArrayOrBitmap, {
            type: 'static',
            key: key,
            rangeMin: this.rangeMin,
            rangeMax: this.rangeMax
        });

        if (!this.#saveBitmapToDb(key, bitmap)) {
            throw new Error(`Unable to save bitmap with key ID "${key}" to database`);
        }

        return bitmap;
    }

    removeBitmap(key) {
        if (!this.#db.has(key)) {
            debug(`Bitmap with key ID "${key}" not found`)
            return false
        }

        debug(`Removing bitmap with key ID "${key}"`)
        this.#cache.delete(key)

        return this.#db.delete(key);

    }

    getBitmap(key) {
        // Return from cache if available
        if (this.#cache.has(key)) return this.#cache.get(key)

        // Load from DB
        if (!this.#db.has(key)) {
            debug(`Bitmap with key ID "${key}" not found`)
            return null
        }

        let bitmap = this.#loadBitmapFromDb(key)
        return bitmap
    }

    hasBitmap(key) { return this.#db.has(key); }

    renameBitmap(key, newKey) {
        let bitmap = this.getBitmap(key)
        if (bitmap == null) return false

        if (!this.createBitmap(newKey, bitmap)) {
            throw new Error(`Unable to create bitmap with key ID "${newKey}"`)
        }

        if (!this.removeBitmap(key)) {
            throw new Error(`Unable to remove bitmap with key ID "${key}"`)
        }

        return true
    }

    /**
     * Bitmap setters/getters
     */

    tick(idOrArray, bitmapKey) {
        let bitmap = this.getBitmap(bitmapKey)
        if (!bitmap) {
            debug(`Bitmap with key ID "${bitmapKey}" not found`)
            return false
        }

        bitmap = bitmap.add(idOrArray)
        debug(`Implicit save for bitmap with key ID "${bitmapKey}"`)
        this.#saveBitmapToDb(bitmapKey, bitmap)

        return bitmap
    }

    untick(idOrArray, bitmapKey) {
        let bitmap = this.getBitmap(bitmapKey)
        if (!bitmap) {
            debug(`Bitmap with key ID "${bitmapKey}" not found`)
            return false
        }

        bitmap = bitmap.remove(idOrArray)
        debug(`Implicit save for bitmap with key ID "${bitmapKey}"`)
        this.#saveBitmapToDb(bitmapKey, bitmap)

        return bitmap
    }

    /**
     * Logical operators
     */

    /*  NEW API */
    /*
    intersectRoaringBitmapsAsync(roaringBitmapArray) {}
    intersectRoaringBitmaps(roaringBitmapArray) {}
    unionRoaringBitmapsAsync(roaringBitmapArray) {}
    unionRoaringBitmaps(roaringBitmapArray) {}

    intersectBitmapsByKeyAsync(bitmapKeyArray) {}
    intersectBitmapsByKey(bitmapKeyArray) {}
    unionBitmapsByKeyAsync(bitmapKeyArray) {}
    unionBitmapsByKey(bitmapKeyArray) {}*/


    AND(keyArray) {
        if (keyArray.length === 0) {
            // TODO: Maybe we should return null here
            return new RoaringBitmap32();
        }

        let partial;
        for (const key of keyArray) {
            const bitmap = this.getBitmap(key);
            // If bitmap is null or empty, return an empty bitmap immediately
            if (!bitmap || bitmap.size === 0) {
                return new RoaringBitmap32();
            }
            // Initialize partial with the first non-empty bitmap
            if (!partial) {
                partial = bitmap;
                continue;
            }
            // Perform AND operation
            partial.andInPlace(bitmap);
        }

        // Return partial or an empty bitmap if it was never assigned
        return partial || new RoaringBitmap32();
    }

    OR(keyArray) {
        const validBitmaps = keyArray.map(key => this.getBitmap(key)).filter(Boolean);
        return validBitmaps.length ? RoaringBitmap32.orMany(validBitmaps) : new RoaringBitmap32();
    }

    //XOR(keyArray, inputBitmap = null) { throw new Error('Not implemented'); }

    static AND(roaringBitmapArray) {

        if (roaringBitmapArray.length === 0) { return new RoaringBitmap32(); }

        let partial;
        for (const bitmap of roaringBitmapArray) {

            if (!bitmap || bitmap.size === 0) {
                return new RoaringBitmap32();
            }

            // Initialize partial with the first non-empty bitmap
            if (!partial) {
                partial = bitmap;
                continue;
            }
            // Perform AND operation
            partial.andInPlace(bitmap);
        }

        // Return partial or an empty bitmap if it was never assigned
        return partial || new RoaringBitmap32();

    }

    static OR(roaringBitmapArray) {
        return RoaringBitmap32.orMany(roaringBitmapArray)
    }

    //static XOR(roaringBitmapArray) {}

    //andCardinality() {}
    //orCardinality() {}
    //jaccardIndex() {}


    /**
     * List all bitmaps in the database/dataset
     * @returns {Array} Array of bitmap keys
     */
    listBitmaps() {
        let bitmaps = [...this.#db.keys()]
        return bitmaps
    }

    getActiveBitmaps() { return this.#cache.list(); }

    clearActiveBitmaps() { this.#cache.clear(); }

    removeBitmapSync(key) {
        if (!this.#db.has(key)) {
            debug(`Bitmap with key ID "${key}" not found`)
            return false
        }

        debug(`Removing bitmap with key ID "${key}"`)
        return this.#db.delete(key);
    }

    /**
     * Renames a bitmap synchronously.
     *
     * @param {string} key - The key of the bitmap to be renamed.
     * @param {string} newKey - The new key for the bitmap.
     * @returns {boolean} - Returns true if the bitmap was renamed successfully, false otherwise.
     */
    renameBitmapSync(key, newKey) {
        let bitmap = this.getBitmap(key)
        if (bitmap == null) return false

        if (!this.createBitmapSync(newKey, bitmap)) {
            debug(`Unable to create bitmap with key ID "${newKey}"`)
            throw new Error(`Unable to create bitmap with key ID "${newKey}"`)
        }

        if (!this.removeBitmapSync(key)) {
            debug(`Unable to remove bitmap with key ID "${key}"`)
            throw new Error(`Unable to remove bitmap with key ID "${key}"`)
        }

        return true
    }

    // Ticks a single key with an ID array or a bitmap
    tickSync(key, oidArrayOrBitmap, autoCreateBitmap = true, implicitSave = true) {
        let bitmap = this.getBitmap(key)
        if (!bitmap) {
            debug(`Bitmap with key ID "${key}" not found`)
            if (!autoCreateBitmap) return false

            debug(`Creating new bitmap with key ID "${key}"`)
            bitmap = new RoaringBitmap32()
        }

        bitmap = bitmap.addMany(oidArrayOrBitmap)
        if (implicitSave) {
            debug(`Implicit save for bitmap with key ID "${key}"`)
            this.#saveBitmapToDb(key, bitmap)
        }

        return bitmap
    }

    /**
     * Updates multiple bitmaps with the given IDs or RoaringBitmap32 instance.
     * @param {Array<string>} keyArray - An array of bitmap keys to update.
     * @param {Array<number>|RoaringBitmap32} oidArrayOrBitmap - An array of IDs or an instance of RoaringBitmap32.
     * @param {boolean} [autoCreateBitmaps=true] - Whether to automatically create bitmaps if they don't exist.
     * @param {boolean} [implicitSave=true] - Whether to implicitly save the bitmaps after updating.
     * @returns {Promise<Array>} A promise that resolves with an array of results from updating each bitmap.
     * @throws {TypeError} If the first argument is not a non-empty array of bitmap keys, or if the second argument is not an array of IDs or an instance of RoaringBitmap32.
     */
    async tickMany(keyArray, oidArrayOrBitmap, autoCreateBitmaps =  true, implicitSave = true) {

        debug(`tickMany(): keyArray: ${keyArray}, oidArrayOrBitmap: ${oidArrayOrBitmap}`)
        if (!Array.isArray(keyArray) || !keyArray.length) {
            throw new TypeError('The first argument to tickMany must be a non-empty array of bitmap keys');
        }

        return Promise.all(keyArray.map(key => {
            return this.tick(key, oidArrayOrBitmap, autoCreateBitmaps, implicitSave);
        }));
    }

    /**
     * Synchronously ticks multiple bitmaps with the given IDs or RoaringBitmap32 instance.
     * @param {Array<string>} keyArray - An array of bitmap keys to tick.
     * @param {Array<number>|RoaringBitmap32} oidArrayOrBitmap - An array of IDs or an instance of RoaringBitmap32.
     * @param {boolean} [autoCreateBitmaps=true] - Whether to automatically create bitmaps if they don't exist.
     * @param {boolean} [implicitSave=true] - Whether to implicitly save the bitmaps after ticking.
     * @returns {Array<Object>} An array of tick results for each bitmap.
     * @throws {TypeError} If the first argument is not a non-empty array of bitmap keys, or if the second argument is not an array of IDs or an instance of RoaringBitmap32.
     */
    tickManySync(keyArray, oidArrayOrBitmap, autoCreateBitmaps = true, implicitSave = true) {
        if (!Array.isArray(keyArray) || !keyArray.length) {
            throw new TypeError(`First argument must be a non-empty array of bitmap keys, "${typeof keyArray}" given`);
        }

        if (typeof oidArrayOrBitmap === 'number') { oidArrayOrBitmap = [oidArrayOrBitmap]; }

        if (!Array.isArray(oidArrayOrBitmap) && !(oidArrayOrBitmap instanceof RoaringBitmap32)) {
            throw new TypeError(`Second argument must be an array of IDs or an instance of RoaringBitmap32, "${typeof oidArrayOrBitmap}" given`);
        }

        const results = keyArray.map(key => {
            return this.tickSync(key, oidArrayOrBitmap, autoCreateBitmaps, implicitSave);
        });

        return results;
    }

    untickSync(key, oidArrayOrBitmap, implicitSave = true) {
        let bitmap = this.getBitmap(key)
        if (!bitmap) {
            debug(`Bitmap with key ID "${key}" not found`)
            return false
        }

        bitmap = bitmap.removeMany(oidArrayOrBitmap)
        if (implicitSave) {
            debug(`Implicit save for bitmap with key ID "${key}"`)
            this.#saveBitmapToDb(key, bitmap)
        }

        return bitmap
    }


    /**
     * Internal methods (sync)
     */

    #saveBitmapToDb(key, bitmap/*, overwrite = true */) {
        if (!(bitmap instanceof RoaringBitmap32)) throw new TypeError(`Input must be an instance of RoaringBitmap32`);
        // TODO: runOptimize()
        // TODO: shrinkToFit()
        // TODO: Overwrite logic

        let bitmapData = bitmap.serialize(true);
        try {
            this.#db.set(key, bitmapData);
        } catch (err) {
            throw new Error(`Unable to save bitmap ${key} to database`);
        }
    }

    #loadBitmapFromDb(key) {
        let bitmapData = this.#db.get(key);
        if (!bitmapData) {
            debug(`Unable to load bitmap "${key}" from the database`)
            return null;
        }

        let bitmap = new RoaringBitmap32();
        bitmap.deserialize(bitmapData, true);
        return bitmap;
    }

}

module.exports = BitmapManager

