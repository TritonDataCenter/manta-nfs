// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var constants = process.binding('constants');
var events = require('events');
var fs = require('fs');
var path = require('path');
var stream = require('stream');
var util = require('util');

var assert = require('assert-plus');
var crc32 = require('sse4_crc32');
var once = require('once');
var joi = require('joi');
var libuuid = require('libuuid');
var LRU = require('lru-cache');
var mkdirp = require('mkdirp');
var statvfs = require('statvfs');
var vasync = require('vasync');



///--- Globals

var sprintf = util.format;

var FMT = '[object %s<root=%s, files=%d, max_files=%d, size=%d, max_size=%d>]';
var SCHEMA = {
    files: {
        key: '::fscache:files:%s',
        schema: {
            // An NFS file-handle (uuid)
            fhandle: joi.string().min(36).required(),
            // The original file (really, manta key) name
            name: joi.string().required(),
            // Where the cached file is on disk
            path: joi.string().required(),
            // Size (in bytes) of the file
            size: joi.number().min(0).integer(),
            // When the file was cached
            expire: joi.date().required(),
            // Were local writes done to this file?
            dirty: joi.boolean(),
            // Is it a directory?
            is_directory: joi.boolean(),
            // Manta information
            etag: joi.string(),
            md5: joi.string()
        }
    },
    fhandles: {
        key: '::fscache:fhandles:%s',
        schema: {
            name: joi.string().required(),
            path: joi.string().required()
        }
    }
};



///--- Errors

function FileNotCachedError(p) {
    this.code = 'ENOENT';
    this.message = util.format('%s does not exist (locally)', p);
    this.name = 'FileNotCachedError';
    Error.captureStackTrace(this, FileNotCachedError);
}
util.inherits(FileNotCachedError, Error);


function NotEnoughSpaceError(p, actual, desired) {
    this.code = 'ENOSPC';
    this.message = util.format('%s has %dMB available(< %dMB)',
                               p, actual, desired);
    this.name = 'NotEnoughSpaceError';
    Error.captureStackTrace(this, NotEnoughSpaceError);
}
util.inherits(NotEnoughSpaceError, Error);


function WriteInProgressError(p) {
    this.code = 'EBUSY';
    this.message = util.format('%s is already being written to', p);
    this.name = 'WriteInProgressError';
    Error.captureStackTrace(this, WriteInProgressError);
}
util.inherits(WriteInProgressError, Error);



// Helpers

// bytes2megabytes
function MB(b) {
    assert.number(b, 'bytes');

    return (Math.floor(b / 1024 /1024));
}


function bytes(mb) {
    assert.number(mb, 'megabytes');

    return (Math.floor(mb * 1024  *1024));
}



///--- API

/**
 * Constructor
 *
 * This creates an FS cache manager, and assumes you are going to pass it in a
 * valid (and open) leveldb handle. Additionally, you pass in the following
 * options:
 *
 * - count<Number>: Maximum number of files to cache
 * - db<leveldb>: DB handle
 * - location<String>: file system root to cache in
 * - log<Bunyan>: log handle
 * - size<Number>: Maximum number of bytes to have resident on disk
 *   -- You can optionally provide sizeMB instead
 * - ttl<Number>: Maximum default age of files
 *
 * Once you instantiate this, wait for the `ready` event.
 */
function FsCache(opts) {
    assert.object(opts, 'options');
    assert.object(opts.db, 'options.db');
    assert.ok(opts.db.isOpen(), 'options.db.isOpen()');
    assert.object(opts.log, 'options.log');
    assert.string(opts.location, 'options.location');
    assert.optionalNumber(opts.count, 'options.count');
    assert.optionalNumber(opts.size, 'options.size');
    assert.optionalNumber(opts.sizeMB, 'options.sizeMB');
    assert.optionalNumber(opts.ttl, 'options.ttl');

    events.EventEmitter.call(this, opts);

    this.cache = LRU({
        dispose: this._evict.bind(this),
        max: opts.count || 10000,
        maxAge: (opts.ttl || 3600) * 1000
    });
    this.db = opts.db;
    this.evictions = vasync.barrier();
    this.location = opts.location;
    this.log = opts.log.child({component: 'FsCache'}, true);
    this.max = opts.size ||
        (opts.sizeMB ? bytes(opts.sizeMB) : 0) ||
        5368709120;
    this.pending_reads = {};
    this.pending_writes = {};
    this.size = 0;
    this.ttl = opts.ttl || 3600;

    // Not guaranteed unique, but good enough
    this._id = crc32.calculate(opts.location);

    this._init();
}
util.inherits(FsCache, events.EventEmitter);
FsCache.prototype.__defineGetter__('files', function () {
    return (this.cache.length);
});
FsCache.prototype.__defineGetter__('max_files', function () {
    return (this.cache.max);
});
FsCache.prototype.__defineGetter__('max_size', function () {
    return (this.max);
});


/**
 * Shuts down the cache, _and_ flushes everythign from disk
 *
 * Emits `close` when done.
 */
FsCache.prototype.close = function close() {
    var done = this.emit.bind(this, 'close');
    if (this.cache.length > 0) {
        this.evictions.once('drain', done);
        this.cache.reset();
    } else {
        setImmediate(done);
    }
};


/**
 * Simply checks whether a given file name exists in the local cache
 *
 * if (cache.has('/tmp/foo'))
 *    ...
 */
FsCache.prototype.has = function has(p) {
    assert.string(p, 'path');

    var key = sprintf(SCHEMA.files.key, path.normalize(p));
    var val = this.cache.peek(key);

    return (val && val.expire > new Date().getTime());
};


FsCache.prototype.get = function get(p) {
    assert.string(p, 'path');

    var key = sprintf(SCHEMA.files.key, path.normalize(p));

    return (this.cache.get(key));
};


FsCache.prototype.lookup = function lookup(fhandle, cb) {
    assert.string(fhandle, 'fhandle');
    assert.func(cb, 'callback');

    var key = sprintf(SCHEMA.fhandles.key, fhandle);
    var log = this.log;

    log.debug('lookup(%s): entered', fhandle);

    this.db.get(key, function (err, val) {
        if (err) {
            log.debug(err, 'lookup(%s): failed', fhandle);
            cb(err);
        } else {
            log.debug('lookup(%s): done: %s', fhandle, val.name);
            cb(null, val.name);
        }
    });
};


/**
 * Just like node's `fs.createWriteStream`, except you _must_ pass in
 * options, and it must have a size attribute.  Additionally, options
 * _should_ contain `etag` and `md5`.  Note that this API will throw
 * if there are already concurrent writes or reads going to the target.
 * Wrap with `cache.pending()` - also, the stream returned by this API
 * adds an extra event over node's stream.Writable `flush`.  Use this
 * to listen for when bytes have been written completely to disk.
 *
 * function put(f, cb) {
 *   cb = once(cb);
 *
 *   if (!cache.pending('/tmp/foo')) {
 *     var stream = cache.createWriteStream('/tmo/foo', {size: 123});
 *     stream.once('error', cb.bind(this));
 *     stream.once('flush', cb.bind(this, null));
 *
 *     stream.write(crypto.randomBytes(123));
 *     stream.end();
 *   }
 * }
 *
 */
FsCache.prototype.createWriteStream = function createWriteStream(name, opts) {
    assert.string(name, 'path');
    assert.object(opts, 'options');
    assert.optionalObject(opts.log, 'options.log');
    assert.number(opts.size, 'options.size');
    assert.optionalNumber(opts.ttl, 'options.ttl');

    name = path.normalize(name);

    var fname = libuuid.create() + '|' + this._id;
    var key = sprintf(SCHEMA.files.key, name);
    var log = opts.log || this.log;
    var now = new Date();
    var p = path.resolve(this.location, fname);
    var self = this;
    var sz = this.size;
    var tmp;
    var val = {
        fhandle: fname,
        name: name,
        path: p,
        size: opts.size,
        expire: now.getTime() + ((opts.ttl || this.ttl) * 1000),
        is_directory: opts.is_directory || opts.directory || false,
        dirty: opts.dirty,
        etag: opts.etag,
        md5: opts.etag
    };
    var w_stream = new stream.PassThrough();

    if (this.pending(name))
        throw new WriteInProgressError(name);

    this.pending_writes[name] = true;

    if (joi.validate(val, SCHEMA.files.schema))
        throw new Error(joi.validate(val, SCHEMA.files.schema).message);

    log.debug({
        key: key,
        value: val
    }, 'createWriteStream(%s): entered', name);

    // If the current file is larger than what we even allow, don't cache,
    // just stub it out so upstack can pipe to /dev/null
    if (opts.size >= this.max) {
        w_stream.on('end', function onDevNullStreamDone() {
            if (self.pending_writes[name])
                delete self.pending_writes[name];
            w_stream.emit('flush');
        });
        w_stream.resume();
        return (w_stream);
    }

    // Evict entries until we have enough space to fit the new guy
    while ((sz + opts.size) >= this.max) {
        if (!(tmp = this.cache.pop())) {
            sz = 0;
        } else {
            sz -= tmp.value.size;
        }
    }

    self.db.batch()
        .put(sprintf(SCHEMA.fhandles.key, fname), {name: name, path: p})
        .put(key, val)
        .write(function onDbWriteDone(err) {
            if (err) {
                w_stream.emit('error', err);
                return;
            }

            var f_stream = fs.createWriteStream(p);
            f_stream.on('error', function onFileWriteErro(err2) {
                fs.unlink(p, function onCleanup(err3) {
                    if (err3) {
                        log.error(err3,
                                  'createWriteStream(%s): unable to ' +
                                  'cleanup %s after error(%s)',
                                  name, p, err3.toString());
                    }

                    if (self.cache.has(key))
                        self.cache.del(key);

                    w_stream.emit('error', err2);
                });
            });

            f_stream.once('open', function onFileWriteReady() {
                self.size += opts.size;
                self.cache.set(key, val);

                log.debug('createWriteStream(%s): piping bytes', name);
                f_stream.once('finish', function onFileWriteDone() {
                    if (self.pending_writes[name])
                        delete self.pending_writes[name];
                    w_stream.emit('flush');
                });
                w_stream.pipe(f_stream);
            });
        });

    return (w_stream);
};


/**
 * Just like node's fs.createReadStream.
 *
 * Note that if the file does not exist, like node's fs.createReadStream,
 * the returned stream will emit an error.  To avoid this, use `cache.has`.
 * Lastly, concurrent access is allowed in this API.
 *
 * if (cache.has('/tmp/foo')) {
 *   var stream = cache.createReadStream('/tmp/foo');
 *   stream.pipe(process.stdout);
 * }
 *
 */
FsCache.prototype.createReadStream = function createReadStream(p, opts) {
    assert.string(p, 'path');
    assert.optionalObject(opts, 'options');

    p = path.normalize(p);

    var key = sprintf(SCHEMA.files.key, p);
    var log = this.log;
    var r_stream = new stream.PassThrough();
    var self = this;
    var val = this.cache.get(key);

    if (!val || new Date().getTime() >= val.expire) {
        setImmediate(r_stream.emit.bind(r_stream,
                                        'error',
                                        new FileNotCachedError(p)));
        return (r_stream);
    }

    log.debug('createReadStream(%s): entered', p);

    this.pending_reads[p] = true;

    var f_stream = fs.createReadStream(val.path, opts);
    f_stream.on('error', function onFileReadError(err2) {
        fs.unlink(p, function onCleanup(err3) {
            if (err3) {
                log.error(err3,
                          'createReadStream(%s): unable to ' +
                          'cleanup %s after error(%s)',
                          p, val.path, err3.toString());
            }

            if (self.cache.has(key))
                self.cache.del(key);

            if (self.pending_reads[p])
                delete self.pending_reads[p];

            r_stream.emit('error', err2);
        });
    });

    f_stream.once('open', function onFileReadReady() {
        log.debug('createReadStream(%s): piping bytes', p);
        f_stream.once('end', function onFileReadDone() {
            if (self.pending_reads[p])
                delete self.pending_reads[p];
        });
        f_stream.pipe(r_stream);
    });

    return (r_stream);
};


FsCache.prototype.mkdir = function mkdir(p, opts) {
    assert.string(p, 'path');
    assert.optionalObject(opts, 'options');

    opts = opts || {};
    opts.is_directory = true;
    opts.size = 0;

    return (this.createWriteStream(p, opts));
};


/**
 * Simply indicates whether or not there are reads || writes in flight
 * for a given file.
 *
 * if(!cache.pending('/tmp/foo'))
 *    ...
 *
 */
FsCache.prototype.pending = function pending(name) {
    assert.string(name, 'name');

    var reading = this.pending_reads[name] ? true : false;
    var writing = this.pending_writes[name] ? true : false;

    return (writing || reading);
};


FsCache.prototype.stat = function stat(p, cb) {
    assert.string(p, 'path');

    p = path.normalize(p);
    cb = once(cb);

    var key = sprintf(SCHEMA.files.key, p);
    var val = this.cache.get(key);

    if (!val || new Date().getTime() >= val.expire) {
        cb(new FileNotCachedError(p), {manta: val});
        return;
    }

    fs.stat(val.path, function (err, stats) {
        if (err) {
            cb(err, {manta: val});
        } else {
            if (val.is_directory)
                stats.mode = constants.S_IFDIR;
            stats.manta = val;
            cb(null, stats);
        }
    });
};


FsCache.prototype.toString = function toString() {
    return (util.format(FMT,
                        this.constructor.name,
                        this.location,
                        this.files,
                        this.max_files,
                        this.size,
                        this.max_size));
};


//-- Private Methods

FsCache.prototype._init = function init() {
    var log = this.log;
    var self = this;

    log.debug('init: entered');

    this._ensure_cache_dir(this.location, function (dir_err) {
        if (dir_err) {
            self.emit('error', dir_err);
            return;
        }

        self._get_fs_stats(self.location, function (err, stats) {
            if (err) {
                self.emit('error', err);
                return;
            }

            if (stats.availableMB < MB(self.size)) {
                self.size = bytes(stats.availableMB);
                log.warn('%s has %dMB available. Using as max size',
                         self.location, stats.availableMB);
            }

            var keys = self.db.createReadStream();
            keys.on('data', function (data) {
                self.cache.set(data.key, data.value);
            });
            keys.once('error', self.emit.bind(self, 'error'));
            keys.once('end', self.emit.bind(self, 'ready'));
        });
    });
};


FsCache.prototype._evict = function _evict(key, val) {
    assert.string(key);

    var log = this.log;
    var self = this;

    log.debug('_evict(%s): entered', key);


    this.evictions.start(key);
    this.db.get(key, function (err, val) {
        if (err) {
            log.error(err, '_evict(%s): error retrieving from leveldb', key);
            self.emit('error', err);
            return;
        }

        log.debug({value: val}, '_evict(%s): value retrieved', key);
        if ((err = joi.validate(val, SCHEMA.files.schema)) !== null) {
            log.fatal({
                err: err,
                value: val
            }, '_evict(%s): data corruption (schema failure)', key);
            self.emit('error', err);
            return;
        }

        fs.unlink(val.path, function (err2) {
            if (err2) {
                log.error(err2, '_evict(%s): error cleaning up from filesystem',
                          key);
                self.emit('error', err2);
                return;
            }

            self.db.del(key, function (err3) {
                if (err3) {
                    log.error(err3,
                              '_evict(%s): error cleaning up from leveldb',
                              key);
                    self.emit('error', err3);
                    return;
                }

                self.size -= val.size;
                self.emit('evict', val.name);
                self.evictions.done(key);
            });
        });
    });
};


FsCache.prototype._ensure_cache_dir = function _ensure_cache_dir(p, cb) {
    assert.string(p, 'path');
    assert.func(cb, 'callback');

    cb = once(cb);

    var log = this.log;

    log.debug('_ensure_cache_directory(%s): entered', p);

    fs.stat(p, function (err, stats) {
        if (err) {
            if (err.code !== 'ENOENT') {
                cb(err);
            } else {
                mkdirp(p, 0755, function (err2) {
                    if (err2) {
                        cb(err2);
                    } else {
                        log.debug('_ensure_cache_directory(%s): done', p);
                        cb(null);
                    }
                });
            }
        } else {
            log.debug({
                stats: stats
            }, '_ensure_cache_directory(%s): done', p);
            cb(null);
        }
    });
};


FsCache.prototype._get_fs_stats = function _fs_stats(p, cb) {
    assert.string(p, 'path');
    assert.func(cb, 'callback');

    cb = once(cb);

    var log = this.log;

    log.debug('_get_fs_stats(%s): entered', p);

    statvfs(p, function (err, stats) {
        if (err) {
            cb(err);
            return;
        }

        var available = stats.bsize * stats.bavail;
        stats.availableMB = Math.floor(available / (1024 * 1024));

        log.debug({
            stats: stats
        }, '_get_fs_stats(%s): done', p);

        cb(null, stats);
    });
};



///--- Exports

// Singleton
var INSTANCES = {};
var INSTANCES_BY_FHANDLE = {};

module.exports = {
    FsCache: FsCache,
    FileNotCachedError: FileNotCachedError,
    NotEnoughSpaceError: NotEnoughSpaceError,
    WriteInProgressError: WriteInProgressError,
    createFsCache: function createFsCache(opts) {
        return (new FsCache(opts));
    },

    // Singleton Functions
    initializeFsCache: function initializeFsCache(cfgs, cb) {
        assert.arrayOfObject(cfgs, 'configurations');
        assert.func(cb, 'callback');

        cb = once(cb);

        var barrier = vasync.barrier();
        var _err;
        barrier.once('drain', function () {
            if (_err) {
                Object.keys(INSTANCES).forEach(function (k) {
                    INSTANCES[k].close();
                });
                cb(_err);
            } else {
                cb();
            }
        });

        cfgs.forEach(function (c) {
            barrier.start(c.name);
            var cache = new FsCache(c);
            cache.once('ready', function () {
                INSTANCES[c.name] = cache;
                INSTANCES_BY_FHANDLE[cache._id + ''] = cache;
                barrier.done(c.name);
            });
            cache.once('error', function (err) {
                _err = _err || err;
                barrier.done(c.name);
            });
        });
    },
    getCache: function getCache(p) {
        assert.string(p, 'path');

        if (!INSTANCES[p])
            throw new Error('No cache found for: ' + p);

        return (INSTANCES[p]);
    },
    getCacheByFhandle: function getCacheByFhandle(f) {
        assert.string(f, 'fhandle');

        var id = f.split('|').pop();
        if (!INSTANCES_BY_FHANDLE[id])
            throw new Error('No cache found for: ' + f);

        return (INSTANCES_BY_FHANDLE[id]);
    }
};
