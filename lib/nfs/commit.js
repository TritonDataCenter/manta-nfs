// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var assert = require('assert-plus');
var nfs = require('nfs');

var common = require('./common');

var fs = require('fs');



///-- API


function commit(call, reply, next) {
    var log = call.log;
    var stats = call.stats;

    log.debug('commit(%s): entered', call.object);

    assert.ok(stats);

    call.fs.fsync(stats.fd, function (err) {
        if (err) {
            log.warn(err, 'commit: fsCache.fsync failed');
            reply.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        reply.send();
        next();
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        common.open,
        commit
    ]);
};
