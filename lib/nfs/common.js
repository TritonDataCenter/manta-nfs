// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var assert = require('assert-plus');
var nfs = require('nfs');
var once = require('once');

var fsCache = require('../fs-cache');



///-- API

function cache_directory(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.cache, 'options.cache');
    assert.object(opts.info, 'options.info');
    assert.object(opts.log, 'options.log');
    assert.object(opts.manta, 'options.manta');
    assert.string(opts.name, 'options.name');

    cb = once(cb);

    if ((opts.cache.has(opts.name))) {
        var _val = opts.cache.get(opts.name);
        setImmediate(cb.bind(this, null, _val.fhandle));
        return;
    }

    opts.log.debug('cache_directory(%s): entered', opts.name);

    var log = opts.log;
    var stream = opts.cache.mkdir(opts.name, opts.info);

    var _cb = once(function (err) {
        if (err) {
            log.warn(err, 'cache_directory(%s): failed to list', opts.name);
            cb(err);
        } else {
            var val = opts.cache.get(opts.name);
            log.debug({cached: val}, 'cache_directory(%s): entered', opts.name);
            cb(null, val.fhandle);
        }
    });

    stream.once('error', _cb);
    stream.once('flush', _cb);
    opts.manta.ls(opts.name, {_no_dir_check: true}, function (err, res) {
        if (err) {
            _cb(err);
            return;
        }

        res.on('entry', function (e) {
            stream.write(JSON.stringify(e) + '\n');
        });

        res.once('error', _cb);
        res.once('end', stream.end.bind(stream));
    });
}


function ensure_file_in_cache(call, reply, next) {
    assert.ok(call.cache, 'call.cache');
    assert.ok(call._filename, 'call._filename');

    var cache = call.cache;
    var log = call.log;
    var p = call._filename;

    log.debug('ensure_file_in_cache(%s): entered', p);


    function fail(err) {
        log.error(err, 'ensure_file_in_cache(%s): failed', p);
        reply.error(nfs.NFS3ERR_SERVERFAULT);
        next(false);
    }

    cache.stat(p, function (err, stats) {
        if (err) {
            if (err.name === 'FileNotCachedError') {
                if (stats && stats.manta.is_directory) {
                    var _opts = {
                        cache: cache,
                        log: log,
                        manta: call.manta,
                        name: p
                    };
                    cache_directory(_opts, function (m_err, m_val) {
                        if (m_err) {
                            fail(m_err);
                            return;
                        }

                        cache.stat(p, function (err2, stats2) {
                            if (err2) {
                                fail(err2);
                                return;
                            }

                            log.debug({
                                stats: stats2
                            }, 'ensure_file_in_cache(%s): done', p);
                            call._stats = stats2;
                            next();
                        });
                    });
                } else {
                    // TODO: fetch! manta.info, then ...
                    // This is where we need to handle entries "disappearing"
                    // and return ESTALE, etc.
                    log.fatal('ensure_file_in_cache: not implemented!');
                    process.abort();
                }
            } else {
                log.debug({
                    err: err
                }, 'ensure_file_in_cache(%s): failed for unknown reason', p);
                fail(err);
            }
            return;
        }

        log.debug({stats: stats}, 'ensure_file_in_cache(%s): done', p);
        call._stats = stats;
        next();
    });
}
    // function fail() {
    //     reply.error(nfs.NFS3ERR_BADHANDLE);
    //     next(false);
    // }

    // try {
    //     call.cache = fsCache.getCacheByFhandle(p);
    // } catch (e) {
    //     log.error(e, 'getattr: %s is invalid', p);
    //     fail();
    //     return;
    // }

    // if (!call.cache) {
    //     fail();
    //     return;
    // }

    // call.cache.lookup(p, function (err, name) {
    //     if (err) {
    //         fail();
    //     } else {
    //         call._filename = name;
    //         log.debug({filename: name}, 'ensure_file_in_cache(%s): done', p);
    //         next();
    //     }
    // });
//}


function fhandle_to_filename(call, reply, next) {
    var fhandle = call.fhandle || call.object;
    var log = call.log;

    log.debug('fhandle_to_filename(%s): entered', fhandle);
    assert.string(fhandle, 'call.fhandle');


    call.cache.lookup(fhandle, function (err, name) {
        if (err) {
            log.warn(err, 'fhandle_to_filename(%s): failed', fhandle);
            reply.error(nfs.NFS3ERR_BADHANDLE);
            next(false);
        } else {
            call._filename = name;
            log.debug('fhandle_to_filename(%s): done: %s', fhandle, name);
            next();
        }
    });
}


function get_cache_by_fhandle(call, reply, next) {
    var fhandle = call.object;
    try {
        call.cache = fsCache.getCacheByFhandle(fhandle);
    } catch (e) {
        call.log.debug(e, 'get_cache_by_fhandle(%s): failed', fhandle);
    }

    if (!call.cache) {
        reply.error(nfs.NFS3ERR_BADHANDLE);
        next(false);
    } else {
        next();
    }
}



///--- Exports

module.exports = {
    cache_directory: cache_directory,
    ensure_file_in_cache: ensure_file_in_cache,
    fhandle_to_filename: fhandle_to_filename,
    get_cache_by_fhandle: get_cache_by_fhandle
};
