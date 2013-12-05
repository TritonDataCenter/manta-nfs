// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var fs = require('fs');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var bunyan = require('bunyan');
var clone = require('clone');
var dashdash = require('dashdash');
var nfs = require('nfs');
var rpc = require('oncrpc');
var mantafs = require('mantafs');
var vasync = require('vasync');

var app = require('./lib');



///--- Globals

var LOG = app.bunyan.createLogger();

var OPTIONS_PARSER = dashdash.createParser({
    options: [
        {
            names: ['file', 'f'],
            type: 'string',
            help: 'configuration file to use',
            helpArg: 'FILE'
        },
        {
            names: ['verbose', 'v'],
            type: 'bool',
            help: 'turn on verbose bunyan logging'
        }
    ]
});



///--- Functions

function usage(msg) {
    var help = OPTIONS_PARSER.help({
        includeEnv: true
    }).trimRight();

    if (msg)
        console.error(util.format.apply(util, arguments));
    console.error('usage: nfsd [OPTIONS]\noptions:\n' + help);

    process.exit(msg ? 1 : 0);
}


function configure() {
    var opts;

    try {
        opts = OPTIONS_PARSER.parse(process.argv);
    } catch (e) {
        usage(e.message);
    }

    if (opts.verbose) {
        LOG = LOG.child({
            level: 'trace',
            src: true
        });
    }

    if (opts.help)
        usage();

    var fname = opts.file || path.resolve(__dirname, 'etc', 'config.json');
    var cfg;
    try {
        cfg = JSON.parse(fs.readFileSync(fname, 'utf8'));
    } catch (e) {
        usage('unable to load %s:\n%s\n', fname, e.toString());
    }

    assert.object(cfg.database, 'config.database');
    assert.object(cfg.manta, 'config.manta');
    assert.object(cfg.mount, 'config.mount');
    assert.object(cfg.nfs, 'config.nfs');
    assert.object(cfg.portmap, 'config.portmap');

    cfg.log = LOG;
    cfg.database.log = LOG;
    cfg.manta.log = LOG;
    cfg.mount.log = LOG;
    cfg.nfs.log = LOG;
    cfg.portmap.log = LOG;

    cfg.manta = app.createMantaClient(cfg.manta);
    cfg.mount.manta = cfg.manta;
    cfg.nfs.manta = cfg.manta;

    return (cfg);
}


function step_down() {
    try {
        process.setgid('nobody');
        process.setuid('nobody');
    } catch (e) {
        LOG.fatal(e, 'unable to setuid/setgid to nobody');
        process.exit(1);
    }
}



///--- Mainline

(function main() {
    var cfg = configure();
    var log = cfg.log;

    // XXX fix config handling
    var e = {
        files: 100,
        log: log.child({component: 'FsCache'}, true),
        manta: cfg.manta,
        path: '/var/tmp/mfsdb',
        sizeMB: 1024,
        ttl: 3600
    };

    var mfs = mantafs.createClient(e);
    mfs.once('error', function (err) {
        log.fatal(err, 'unable to initialize mantafs cache');
        process.exit(1);
    });
    mfs.once('ready', function () {
        var _p = cfg.portmap.port || 111;
        var _h = cfg.portmap.host || '0.0.0.0';
        var pmapd = app.createPortmapServer(cfg.portmap);
        pmapd.listen(_p, _h, function () {
            step_down();

            cfg.mount.fs = mfs;
            cfg.mount.cachepath = '/var/tmp/mfsdb';    // XXX
            cfg.nfs.fs = mfs;
            cfg.nfs.cachepath = '/var/tmp/mfsdb';    // XXX

            var barrier = vasync.barrier();
            var mountd = app.createMountServer(cfg.mount);
            var nfsd = app.createNfsServer(cfg.nfs);

            barrier.on('drain', function onRunning() {
                var ma = mountd.address();
                var na = nfsd.address();
                var pa = pmapd.address();

                log.info('mountd: listening on: tcp://%s:%d',
                         ma.address, ma.port);
                log.info('nfsd: listening on: tcp://%s:%d',
                         na.address, na.port);
                log.info('portmapd: listening on: tcp://%s:%d',
                         pa.address, pa.port);
            });

            barrier.start('mount');
            mountd.listen(cfg.mount.port || 1892,
                          cfg.mount.host || '0.0.0.0',
                          barrier.done.bind(barrier, 'mount'));

            barrier.start('nfs');
            nfsd.listen(cfg.nfs.port || 2049,
                        cfg.nfs.host || '0.0.0.0',
                        barrier.done.bind(barrier, 'nfs'));

        });
    });
})();
