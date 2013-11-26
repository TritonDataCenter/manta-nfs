// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var fsCache = require('../fs-cache');

var common = require('./common');



///-- API

function getattr(req, res, next) {
    var log = req.log;

    log.debug('getattr(%s): entered', req.object);
    req.cache.stat(req._filename, function (err, stats) {
        if (err) {
            req.log.warn(err, 'getattr: fsCache.stat failed');
            res.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        log.debug(stats, 'getattr(%s): stats returned from cache');

        res.setAttributes(stats);
        res.send();
        next();
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.get_cache_by_fhandle,
        common.fhandle_to_filename,
        common.ensure_file_in_cache,
        getattr
    ]);
};
