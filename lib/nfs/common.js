// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var assert = require('assert-plus');
var nfs = require('nfs');
var once = require('once');



///-- API


function fhandle_to_filename(call, reply, next) {
    var fhandle = call.fhandle || call.object;
    var log = call.log;

    log.debug('fhandle_to_filename(%s): entered', fhandle);
    assert.string(fhandle, 'call.fhandle');


    call.fs.fhandle_to_path(fhandle, function (err, name) {
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


///--- Exports

module.exports = {
    fhandle_to_filename: fhandle_to_filename
};
