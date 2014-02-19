// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var nfs = require('nfs');

var common = require('./common');

var rpc = require('oncrpc');
var XDR = rpc.XDR;


///--- Helpers

function rand() {
    return (Math.floor((Math.random() * Math.pow(2, 31)) + 1));
}



///-- API

function readdir(call, reply, next) {
    var log = call.log;
    log.debug('readdir(%s): entered', call._filename);

    call.fs.readdir(call._filename, function (err, files) {
        if (err) {
            log.warn(err, 'readdir(%s): failed', call.dir);
            reply.error(err.code === 'ENOTDIR' ?
                        nfs.NFS3ERR_NOTDIR :
                        nfs.NFS3ERR_IO);
            next(false);
            return;
        }

        // XXX - can we use cached dir timestamp instead?
        // Since the manta dir timestamp does not change when the dir is
        // modified, use the number of files in the dir as the cookieverf.
        // This is not very good since it will be the same if we delete then
        // add a file in the dir.
        //
        // The cookieverf will be 0 on the initial call.
        if (call.cookieverf.readUInt32LE(0) != 0) {
            // This is a follow-up call. Check to see if the directory has
            // changed.
            if (call.cookieverf.readUInt32LE(0) != files.length) {
                reply.error(nfs.NFS3ERR_BAD_COOKIE);
                next(false);
                return;
            }
        }

        reply.eof = true;

        var cook = 1;
        // Track the returned data size
        // status (4) + bool_dir_attrs (4) + fattr3.XDR_SIZE +
        // cookieverf3 (8) + bool_eof (4) + final_list_false (4)
        // See nfs readdir_reply.js.
        var sz = 116;
        files.every(function (f) {
            // The call cookie will be 0 on the initial call
            if (call.cookie != 0 && call.cookie >= cook) {
                // we need to scan the dir until we reach the right entry
                cook++;
                return (true);
            }

            // We need to track the returned data size to be sure we fit in
            // call.count bytes.
            // list_true (4) + fileid (8) + cookie (8) + name_len
            var delta = 20 + XDR.byteLength(f);
            if ((sz + delta) > call.count) {
                reply.eof = false;
                return (false);
            }

            reply.addEntry({
                fileid: common.hash(path.join(call._filename, f)),
                name: f,
                cookie: cook++
            });
            sz += delta;
            return (true);
        });

        reply.cookieverf = new Buffer(8);
        // Use the number of files as the cookieverf
        reply.cookieverf.writeUInt32LE(files.length, 0, true);

        call.fs.stat(call._filename, function (err2, stats) {
            if (err2) {
                log.warn(err2, 'readdir(%s): stat failed', call._filename);
            } else {
                reply.setDirAttributes(stats);
            }
            reply.send();
            next();
        });
    });
}


///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        readdir
    ]);
};
