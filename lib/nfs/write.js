// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var common = require('./common');

var fs = require('fs');


///-- API

function write(req, res, next) {
    var log = req.log;

    log.debug('write(%s, %d, %d): entered', req.object, req.offset, req.count);

    req.fs.open(req._filename, 'r+', function (open_err, fd) {
        if (open_err) {
            req.log.warn(open_err, 'write: open failed');
            res.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        req.fs.write(fd, req.data, 0, req.count, req.offset,
          function (wr_err, n, b) {
            req.fs.close(fd, function (close_err) {
                // we're ignoring errors on close
                if (wr_err) {
                    req.log.warn(wr_err, 'write: failed');
                    res.error(nfs.NFS3ERR_SERVERFAULT);
                    next(false);
                    return;
                }

                log.debug('write(%d): done', n);

                res.count = n;
                res.committed = nfs.stable_how.FILE_SYNC;
                res.send();
                next();
            });
        });
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        write
    ]);
};
