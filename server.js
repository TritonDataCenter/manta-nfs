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
            names: ['debug', 'd'],
            type: 'bool',
            help: 'turn on debug bunyan logging'
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
    } else if (opts.debug) {
        LOG = LOG.child({
            level: 'debug',
            src: true
        });
    } else {
        LOG = LOG.child({
            level: 'info',
            src: true
        });
    }

    if (opts.help)
        usage();

    var cfg;
    if (opts.file) {
        try {
            cfg = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
        } catch (e) {
            usage('unable to load %s:\n%s\n', opts.file, e.toString());
        }
    } else {
        cfg = {};
    }

    if (cfg.manta) {
        assert.object(cfg.manta, 'config.manta');
    } else if (process.env.MANTA_USER && process.env.HOME) {
        // use the manta config in the environment
        // assume if MANTA_USER is set, all 3 are set
        cfg.manta = {
            'keyFile': path.join(process.env.HOME, '.ssh/id_rsa'),
            'keyId': process.env.MANTA_KEY_ID,
            'url': process.env.MANTA_URL,
            'user': process.env.MANTA_USER
        };
    } else {
        usage('missing manta configuration and no manta environment variables');
    }

    cfg.nfs = {};

    if (cfg.database) {
        assert.object(cfg.database, 'config.database');
    } else {
        // default local cache config
        cfg.database = {
            'location': '/var/tmp/mfsdb',
            'max_files': 100,
            'sizeMB': 1024,
            'ttl': 3600
        };
    }

    if (cfg.portmap) {
        assert.object(cfg.portmap, 'config.portmap');
        // normally only need to define this section if setting
        // 'usehost': 1
        // so that we use the system's portmapper, although you could override
        // the prognum/vers/port for testing
    } else {
        cfg.portmap = {
            'port': 111,
            'mappings': {
                'mountd': [ {
                    'prog': 100005,
                    'vers': 3,
                    'prot': 6,
                    'port': 1892
                }, {
                    'prog': 100005,
                    'vers': 1,
                    'prot': 6,
                    'port': 1892
                }],
                'nfsd': [ {
                    'prog': 100003,
                    'vers': 3,
                    'prot': 6,
                    'port': 2049
                }],
                'portmapd': [ {
                    'prog': 100000,
                    'vers': 2,
                    'prot': 6,
                    'port': 111
                }]
            }
        };
    }

    if (cfg.mount) {
        assert.object(cfg.mount, 'config.mount');
        // normally only need to define this if you want to query the mountd to
        // see exports. If defined, mounts are restricted to these paths. e.g.
        //     'exports': {
        //        '/user/public/foo': {},
        //        '/user/stor': {}
        //     }
    } else {
        cfg.mount = {};
    }

    cfg.log = LOG;
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

// Runs the mountd and nfsd servers. Called once we're registered with the
// system's portmapper or once we've started our own portmapper.
function run_servers(log, cfg_mount, cfg_nfs) {
    var barrier = vasync.barrier();
    var mountd = app.createMountServer(cfg_mount);
    var nfsd = app.createNfsServer(cfg_nfs);

    barrier.on('drain', function onRunning() {
        var ma = mountd.address();
        var na = nfsd.address();

        log.info('mountd: listening on: tcp://%s:%d',
                 ma.address, ma.port);
        log.info('nfsd: listening on: tcp://%s:%d',
                 na.address, na.port);
    });

    barrier.start('mount');
    mountd.listen(cfg_mount.port || 1892,
                  cfg_mount.host || '0.0.0.0',
                  barrier.done.bind(barrier, 'mount'));

    barrier.start('nfs');
    nfsd.listen(cfg_nfs.port || 2049,
                cfg_nfs.host || '0.0.0.0',
                barrier.done.bind(barrier, 'nfs'));
}

///--- Mainline

(function main() {
    var cfg = configure();
    var log = cfg.log;

    var mfs = mantafs.createClient({
        files: cfg.database.max_files,
        log: log.child({component: 'MantaFs'}, true),
        manta: cfg.manta,
        path: cfg.database.location,
        sizeMB: cfg.database.sizeMB,
        ttl: cfg.database.ttl
    });

    cfg.mount.fs = mfs;
    cfg.nfs.fs = mfs;
    cfg.nfs.cachepath = cfg.database.location;    // used by fsstat

    var mntmapping = {
        prog: 100005,
        vers: 3,
        prot: 6,
        port: 1892
    };

    var nfsmapping = {
        prog: 100003,
        vers: 3,
        prot: 6,
        port: 2049
    };
    var pmapclient;

    process.on('SIGINT', function () {
        log.info('Got SIGINT, shutting down.');
        mfs.shutdown(function (err) {
            if (err) {
                log.warn(err, 'mantafs shutdown error');
            }

            if (cfg.portmap.usehost) {
                pmapclient.unset(mntmapping, function (err1) {
                    if (err1) {
                        log.warn(err1,
                            'unable to unregister mountd from the portmapper');
                    }

                    pmapclient.unset(nfsmapping, function (err2) {
                        if (err2) {
                            log.warn(err2,
                            'unable to unregister nfsd from the portmapper');
                        }
                        log.info('Shutdown complete, exiting.');
                        process.exit(0);
                    });
                });
            } else {
                log.info('Shutdown complete, exiting.');
                process.exit(0);
            }
        });
    });

    mfs.once('error', function (err) {
        log.fatal(err, 'unable to initialize mantafs cache');
        process.exit(1);
    });
    mfs.once('ready', function () {
        cfg.portmap.host = cfg.portmap.host || '0.0.0.0';
        cfg.portmap.port = cfg.portmap.port || 111;

        if (cfg.portmap.usehost) {
            // Here we register with the system's existing portmapper

            cfg.portmap.url = util.format('udp://%s:%d',
                cfg.portmap.host, cfg.portmap.port);
            pmapclient = app.createPortmapClient(cfg.portmap);

            pmapclient.once('connect', function () {
                pmapclient.set(mntmapping, function (err1) {
                    if (err1) {
                        log.fatal(err1,
                            'unable to register mountd with the portmapper');
                        process.exit(1);
                    }

                    pmapclient.set(nfsmapping, function (err2) {
                        if (err2) {
                            log.fatal(err2,
                                'unable to register nfsd with the portmapper');
                            process.exit(1);
                        }

                        run_servers(cfg.log, cfg.mount, cfg.nfs);
                    });
                });
            });
        } else {
            // Here we run our own portmapper

            var pmapd = app.createPortmapServer(cfg.portmap);
            pmapd.listen(cfg.portmap.port, cfg.portmap.host, function () {
                // XXX Before we step_down make sure the cache dir is writeable
                // with the lower privs. Who should own the cache and what
                // should the mode be for proper security.
                // step_down();

                run_servers(cfg.log, cfg.mount, cfg.nfs);
            });
       }
    });
})();
