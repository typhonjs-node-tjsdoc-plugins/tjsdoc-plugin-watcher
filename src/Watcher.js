import fs               from 'fs';
import path             from 'path';
import readline         from 'readline';

import ManualWatchGroup from './ManualWatchGroup.js';
import WatchGroup       from './WatchGroup.js';

let watcher;

/**
 * Provides file watching control flow for TJSDoc during the `onComplete` callback. There are several watch groups setup
 * for various files used to produce documentation:
 *
 * - index - The index.html markdown file; default: ./README.md
 * - manual - Any user specified manual pages from the target project config -> `publisherOptions.manual`.
 * - source - The source globs from the target project config.
 * - test - The test source globs from the target project config.
 *
 * Events are fired when files are added, changed, unlinked for any matched globs triggering an event on the plugin
 * eventbus under `tjsdoc:system:watcher:update` with the following object hash:
 *
 * - action: 'file:<add|change|unlink>'
 * - type: '<index|manual|source|test>',
 * - path: the file path
 * - [section]: for manual files the manual section is added if a reverse match is found against the file path.
 * - options: the current optional parameter state.
 */
class Watcher
{
   /**
    * Instantiate Walker then initialize it.
    *
    * @param {PluginEvent} ev - The `onComplete` plugin event.
    */
   constructor(ev)
   {
      /**
       * The plugin event proxy.
       * @type {EventProxy}
       */
      this.eventbus = ev.eventbus;

      /**
       * A local event proxy for Watcher.
       * @type {EventProxy}
       */
      this.eventProxy = ev.eventbus.createEventProxy();

      /**
       * Stores a hash of supported terminal commands.
       * @type {{}}
       */
      this.commands = {};

      /**
       * The plugin options.
       * @type {object}
       */
      this.pluginOptions = ev.pluginOptions;

      /**
       * Any chokidar options taken from plugin options.
       * @type {object}
       */
      this.chokidarOptions = this.pluginOptions.chokidarOptions || {};

      /**
       * Stores any optional on / off actions which store a boolean for current state.
       *
       * trigger: while true runtime watcher events are triggered or logging occurs; default: true
       * silent: if true then no output is logged; default: false.
       * verbose: if true then additional verbose output is logged; default: false.
       *
       * @type {{trigger: boolean, silent: boolean, verbose: boolean}}
       */
      this.options =
      {
         silent: typeof this.pluginOptions.silent === 'boolean' ? this.pluginOptions.silent : false,
         trigger: typeof this.pluginOptions.trigger === 'boolean' ? this.pluginOptions.trigger : true,
         verbose: typeof this.pluginOptions.verbose === 'boolean' ? this.pluginOptions.verbose : false
      };

      /**
       * If true then an interactive terminal is enabled; default: true.
       * @type {boolean}
       */
      this.terminal = typeof this.pluginOptions.terminal === 'boolean' ? this.pluginOptions.terminal : true;

      /**
       * Tracks the terminal prompt when it is visible.
       * @type {boolean}
       */
      this.promptVisible = false;

      /**
       * The chokidar watcher instance for the index / README file.
       * @type {Object}
       */
      this.indexWatcher = void 0;

      /**
       * The chokidar watcher instance for the manual globs.
       * @type {Object}
       */
      this.manualWatcher = void 0;

      /**
       * The chokidar watcher instance for source globs.
       * @type {Object}
       */
      this.sourceWatcher = void 0;

      /**
       * The chokidar watcher instance for test source globs.
       * @type {Object}
       */
      this.testWatcher = void 0;

      /**
       * The interactive terminal readLine instance.
       * @type {Object}
       */
      this.readline = void 0;

      // Adds persistent event bindings.
      ev.eventbus.on('tjsdoc:system:watcher:command:add', this.addCommand, this);
      ev.eventbus.on('tjsdoc:system:watcher:globs:get', this.getGlobs, this);
      ev.eventbus.on('tjsdoc:system:watcher:options:get', this.getOptions, this);
      ev.eventbus.on('tjsdoc:system:watcher:options:set', this.setOptions, this);

      this.initializeCommands();
   }

   /**
    * Adds a terminal command.
    *
    * There is a special `optional` command which provides default handling for `on/off` boolean states. No `exec`
    * function needs to be applied as interested components should
    *
    * @param {object}      command - The command to add
    *
    * @property {string}   command.name - The name of the command.
    *
    * @property {string}   command.description - The description of the command for help option.
    *
    * @property {function} command.exec - The description of the command for help option.
    */
   addCommand(command = {})
   {
      if (typeof command !== 'object') { throw new TypeError(`'command' is not an 'object'.`); }
      if (typeof command.name !== 'string') { throw new TypeError(`'command.name' is not a 'string'.`); }
      if (typeof command.description !== 'string') { throw new TypeError(`'command.description' is not a 'string'.`); }

      // Wrap optional commands with a function that will set the tracked option state locally.
      // The original exec function is invoked with the current state.
      if (typeof command.type === 'string' && command.type === 'optional')
      {
         const origExec = command.exec;

         // If not already set and initial state is provided then set it otherwise 'false' is assigned.
         if (typeof this.options[command.name] !== 'boolean')
         {
            this.options[command.name] = typeof command.state === 'boolean' ? command.state : false;
         }

         // Define the default optional execution function to parse `on/off` and set state accordingly.
         command.exec = ({ command, lineSplit, showPrompt } = {}) =>
         {
            if (typeof lineSplit[1] === 'string')
            {
               switch (lineSplit[1])
               {
                  case 'off':
                     this.options[command.name] = false;
                     this.eventbus.trigger('tjsdoc:system:watcher:options:changed', this.getOptions());
                     if (typeof origExec === 'function') { origExec(false); }
                     break;

                  case 'on':
                     this.options[command.name] = true;
                     this.eventbus.trigger('tjsdoc:system:watcher:options:changed', this.getOptions());
                     if (typeof origExec === 'function') { origExec(true); }
                     break;

                  default:
                     throw new Error(`${command.name} command malformed; must be '${command.name} [on/off]'`);
               }
            }
            else
            {
               throw new Error(`${command.name} command malformed; must be '${command.name} [on/off]'`);
            }

            showPrompt();
         };
      }
      else
      {
         if (typeof command.exec !== 'function') { throw new TypeError(`'command.exec' is not a 'function'.`); }
      }

      this.commands[command.name] = command;
   }

   /**
    * Get the currently watched source and test glob patterns.
    *
    * @returns {{source: Array, test: Array}}
    */
   getGlobs()
   {
      return {
         index: this.config.index ? [this.config.index] : [],
         manual: this.manualGlobs ? this.manualGlobs.all : [],
         source: this.config._sourceGlobs ? this.config._sourceGlobs : [],
         test: this.config.test && this.config.test._sourceGlobs ? this.config.test._sourceGlobs : []
      };
   }

   /**
    * Gets the current user settable options.
    *
    * @returns {{trigger: boolean, silent: boolean, verbose: boolean}}
    */
   getOptions()
   {
      return JSON.parse(JSON.stringify(this.options));
   }

   /**
    * Get the currently watched globs and files.
    *
    * @param {object}      [options] - Optional parameters.
    * @property {boolean}  [options.relative] - If true then all directory paths in `files` is made relative to CWD.
    *
    * @returns {{index: {globs: Array, files: {}}, manual: {globs: Array, files: {}}, source: {globs: Array, files: {}}, test: {globs: Array, files: {}}}}
    */
   getWatching(options)
   {
      const indexGlobs = this.config.index ? [this.config.index] : [];
      const indexFiles = this.indexWatcher ? this.indexWatcher.getWatched() : {};
      const manualGlobs = this.manualGlobs.all ? this.manualGlobs.all : [];
      const manualFiles = this.manualWatcher ? this.manualWatcher.getWatched() : {};
      const sourceGlobs = this.config._sourceGlobs ? this.config._sourceGlobs : [];
      const sourceFiles = this.sourceWatcher ? this.sourceWatcher.getWatched() : {};
      const testGlobs = this.config.test && this.config.test._sourceGlobs ? this.config.test._sourceGlobs : [];
      const testFiles = this.testWatcher ? this.testWatcher.getWatched() : {};

      // Filter absolute paths converting them to relative.
      if (typeof options === 'object' && typeof options.relative === 'boolean' && options.relative)
      {
         for (const key in indexFiles)
         {
            const relKey = path.relative('.', key);
            indexFiles[relKey] = indexFiles[key];
            delete indexFiles[key];
         }

         for (const key in manualFiles)
         {
            const relKey = path.relative('.', key);
            manualFiles[relKey] = manualFiles[key];
            delete manualFiles[key];
         }

         for (const key in sourceFiles)
         {
            const relKey = path.relative('.', key);
            sourceFiles[relKey] = sourceFiles[key];
            delete sourceFiles[key];
         }

         for (const key in testFiles)
         {
            const relKey = path.relative('.', key);
            testFiles[relKey] = testFiles[key];
            delete testFiles[key];
         }
      }

      return {
         index: { globs: indexGlobs, files: indexFiles },
         manual: { globs: manualGlobs, files: manualFiles },
         source: { globs: sourceGlobs, files: sourceFiles },
         test: { globs: testGlobs, files: testFiles }
      };
   }

   /**
    * Performs the ignored match against the path against the `_includes` and `_excludes` entries in the given
    * `config` object.
    *
    * @param {string}   path - file / directory path.
    *
    * @param {object}   config - object to use for `_includes` and `_excludes`.
    *
    * @returns {boolean}
    */
   ignoredMatch(path, config)
   {
      let ignored = false;

      let match = false;

      for (const reg of config._includes)
      {
         if (path.match(reg))
         {
            match = true;
            break;
         }
      }

      if (!match) { ignored = true; }

      for (const reg of config._excludes)
      {
         if (path.match(reg)) { ignored = true; }
      }

      return ignored;
   }

   /**
    * Provides an `ignores` function consumable by chokidar `options.ignored`. `config._includes` and `config._excludes`
    * is used to provide additional file filtering.
    *
    * @param {string}   path - file / directory path.
    * @param {Object}   stats - fs.Stats instance (may be undefined)
    *
    * @returns {boolean} false for not ignore; true to ignore file / directory.
    */
   ignoredSource(path, stats)
   {
      let ignored = false;

      // Attempt to retrieve fs.Stats; this may fail, but match against the path regardless.
      try { stats = stats || fs.lstatSync(path); }
      catch (err) { ignored = this.ignoredMatch(path, this.config); }

      // Match all files.
      if (stats && stats.isFile()) { ignored = this.ignoredMatch(path, this.config); }

      return ignored;
   }

   /**
    * Provides an `ignores` function consumable by chokidar `options.ignored`. `config.test._includes` and
    * `config.test._excludes` is used to provide additional file filtering.
    *
    * @param {string}   path - file / directory path.
    * @param {Object}   stats - fs.Stats instance (may be undefined)
    *
    * @returns {boolean} false for not ignore; true to ignore file / directory.
    */
   ignoredTest(path, stats)
   {
      let ignored = false;

      // Attempt to retrieve fs.Stats; this may fail, but match against the path regardless.
      try { stats = stats || fs.lstatSync(path); }
      catch (err) { ignored = this.ignoredMatch(path, this.config.test); }

      // Match all files.
      if (stats && stats.isFile()) { ignored = this.ignoredMatch(path, this.config.test); }

      return ignored;
   }

   /**
    * Performs setup and initialization of all chokidar watcher instances and the readline terminal.
    *
    * @param {TJSDocConfig} config - The TJSDoc config object.
    */
   initialize(config)
   {
      /**
       * The target project TJSDocConfig object.
       * @type {TJSDocConfig}
       */
      this.config = config;

      // Potentially obtain manual glob object hash from publisher module which lists manual files to watch under the
      // entry 'all' and by section under `sections`.
      {
         const globs = this.eventProxy.triggerSync('tjsdoc:data:publisher:config:manual:globs:get');

         // Set only if it is an object and has `all` and `sections` entries.
         if (typeof globs === 'object' && globs.all && globs.sections) { this.manualGlobs = globs; }
      }

      this.eventProxy.on('tjsdoc:system:watcher:shutdown', this.shutdownCallback, this);
      this.eventProxy.on('tjsdoc:system:watcher:watching:get', this.getWatching, this);
      this.eventProxy.on('tjsdoc:system:watcher:terminal:log', this.log, this);
      this.eventProxy.on('tjsdoc:system:watcher:terminal:log:verbose', this.logVerbose, this);

      const watcherPromises = [];

      if (fs.existsSync(config.index))
      {
         this.log(`tjsdoc-plugin-watcher - watching index: ${config.index}`);

         this.indexWatcher = new WatchGroup(this, config.index, 'index');

         watcherPromises.push(this.indexWatcher.initialize(this.chokidarOptions));
      }

      if (this.manualGlobs && this.manualGlobs.all.length > 0)
      {
         this.log(`tjsdoc-plugin-watcher - watching manual globs: ${JSON.stringify(this.manualGlobs.all)}`);

         this.manualWatcher = new ManualWatchGroup(this, this.manualGlobs, 'manual');

         watcherPromises.push(this.manualWatcher.initialize(this.chokidarOptions));
      }

      if (config._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching source globs: ${JSON.stringify(config._sourceGlobs)}`);

         this.sourceWatcher = new WatchGroup(this, config._sourceGlobs, 'source');

         watcherPromises.push(this.sourceWatcher.initialize(this.chokidarOptions, this.ignoredSource.bind(this)));
      }

      if (config.test && config.test._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);

         this.testWatcher = new WatchGroup(this, config.test._sourceGlobs, 'test');

         watcherPromises.push(this.testWatcher.initialize(this.chokidarOptions, this.ignoredTest.bind(this)));
      }

      Promise.all(watcherPromises).then((results) =>
      {
         const watcherStartData = Object.assign(
         {
            source: { globs: [], files: {} },
            test: { globs: [], files: {} },
            index: { globs: [], files: {} },
            manual: { globs: [], files: {} }
         }, ...results);

         this.log(`tjsdoc-plugin-watcher - type 'help' for options.`);

         this.eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData);
      });

      if (watcherPromises.length > 0)
      {
         // If there is no terminal enabled hook into process SIGINT event. Otherwise set terminal readline loop
         // waiting for the user to type in the commands: `exit`, `globs`, `help`, `trigger`, `regen`, `silent`,
         // `status`, `verbose`, `watching`. The readline terminal will hook into SIGINT (`Ctrl-C`) & SIGHUP (`Ctrl-D`)
         // events and will send the close event if activated.
         if (!this.terminal)
         {
            process.on('SIGINT', this.processInterruptCallback.bind(this));
         }
         else
         {
            const rlConfig = !this.options.silent ?
             { input: process.stdin, output: process.stdout, prompt: '[32mTJSDoc>[0m ' } : { input: process.stdin };

            this.readline = readline.createInterface(rlConfig);

            const showPrompt = () =>
            {
               if (!this.options.silent)
               {
                  this.promptVisible = true;
                  this.readline.prompt();
               }
            };

            // Readline will catch Ctrl-C / Ctrl-D and emit the close event.
            this.readline.on('close', () =>
            {
               if (this.readline)
               {
                  this.readline = void 0;
                  setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown'));
               }
            });

            this.readline.on('line', (line) =>
            {
               this.promptVisible = false;

               const lineSplit = line.trim().split(' ');

               try
               {
                  const command = this.commands[lineSplit[0]];

                  // Handle command if it is defined and has an `exec` function.
                  if (typeof command === 'object' && typeof command.exec === 'function')
                  {
                     command.exec({ command, config, line, lineSplit, options: this.getOptions(), showPrompt });
                     return;
                  }
               }
               catch (err)
               {
                  this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - ${err.message}[0m`);

                  showPrompt();

                  return;
               }

               // If the entered command is anything except empty (``) then post an unknown command message.
               if (lineSplit[0] !== '')
               {
                  this.eventbus.trigger('log:info:raw',
                   `[32mtjsdoc-plugin-watcher - unknown command (type 'help' for instructions)[0m`);
               }

               showPrompt();
            });

            this.eventbus.trigger('tjsdoc:system:watcher:initialized', this.getGlobs());
         }
      }
      else
      {
         this.log('tjsdoc-plugin-watcher: no main source or tests to watch.');
      }
   }

   /**
    * Initializes all built-in terminal commands:
    *
    * `exit`      - Shutdown watcher and exit TJSDoc execution.
    * `globs`     - List the source and test globs being watched.
    * `help`      - Log a listing of commands.
    * `trigger`   - [on/off], turns on / off triggering watcher events.
    * `regen`     - Regenerates all documentation.
    * `silent`    - [on/off], turns on / off logging.
    * `status`    - Logs current optional status.
    * `verbose`   - [on/off], turns on / off verbose logging.
    * `watching`  - Logs the files being watched.
    */
   initializeCommands()
   {
      this.addCommand(
      {
         name: 'exit',
         description: 'shutdown watcher',
         exec: () => setImmediate(() => this.readline.close())
      });

      this.addCommand(
      {
         name: 'globs',
         description: 'list globs being watched',
         exec: ({ config, showPrompt } = {}) =>
         {
            if (config._sourceGlobs)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching source globs: ${
                JSON.stringify(config._sourceGlobs)}[0m`);
            }

            if (config.test && config.test._sourceGlobs)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching test globs: ${
                JSON.stringify(config.test._sourceGlobs)}[0m`);
            }

            showPrompt();
         }
      });

      this.addCommand(
      {
         name: 'help',
         description: 'this listing of commands',
         exec: ({ showPrompt } = {}) =>
         {
            this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - options:[0m`);

            Object.keys(this.commands).sort().forEach((key) =>
            {
               const next = this.commands[key];
               this.eventbus.trigger('log:info:raw',
                `[32m  '${next.name}'${next.type === 'optional' ? ' [on/off], ' : ', '}${next.description}[0m`);
            });

            showPrompt();
         }
      });

      this.addCommand(
      {
         name: 'regen',
         description: 'regenerate all documentation',
         exec: () => setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown', { regenerate: true }))
      });

      this.addCommand(
      {
         name: 'silent',
         description: 'turns on / off logging',
         type: 'optional'
      });

      this.addCommand(
      {
         name: 'status',
         description: 'logs current optional status',
         exec: ({ showPrompt } = {}) =>
         {
            this.eventbus.trigger('log:info:raw', '[32mtjsdoc-plugin-watcher - status:[0m');

            const keys = Object.keys(this.options);
            keys.sort();

            // Log current optional state.
            for (const key of keys)
            {
               this.eventbus.trigger('log:info:raw', `[32m  ${key}: ${this.options[key]}[0m`);
            }

            this.eventbus.trigger('log:info:raw', '');

            showPrompt();
         }
      });

      this.addCommand(
      {
         name: 'trigger',
         description: 'turns on / off triggering watcher events',
         type: 'optional'
      });

      this.addCommand(
      {
         name: 'verbose',
         description: 'turns on / off verbose logging',
         type: 'optional'
      });

      this.addCommand(
      {
         name: 'watching',
         description: 'the files being watched',
         exec: ({ showPrompt } = {}) =>
         {
            if (this.indexWatcher)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching index files: ${
                JSON.stringify(this.indexWatcher.getWatched())}[0m`);
            }

            if (this.manualWatcher)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching manual files: ${
                JSON.stringify(this.manualWatcher.getWatched())}[0m`);
            }

            if (this.sourceWatcher)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching source files: ${
                JSON.stringify(this.sourceWatcher.getWatched())}[0m`);
            }

            if (this.testWatcher)
            {
               this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - watching test files: ${
                JSON.stringify(this.testWatcher.getWatched())}[0m`);
            }

            showPrompt();
         }
      });
   }

   /**
    * Outputs a log message if not `silent`. If the terminal prompt is visible then a new line is output first.
    *
    * @param {string}   message - The log message.
    */
   log(message)
   {
      if (!this.options.silent && this.options.trigger)
      {
         if (this.promptVisible)
         {
            console.log('');
            this.promptVisible = false;
         }

         this.eventbus.trigger('log:info:time', message);
      }
   }

   /**
    * Outputs a log message if not `silent` and `verbose` mode is enabled. If the terminal prompt is visible then a
    * new line is output first.
    *
    * @param {string}   message - The log message.
    */
   logVerbose(message)
   {
      if (this.options.verbose && !this.options.silent && this.options.trigger)
      {
         if (this.promptVisible)
         {
            console.log('');
            this.promptVisible = false;
         }

         this.eventbus.trigger('log:info:time', message);
      }
   }

   /**
    * Handles any SIGINT received by `process`.
    */
   processInterruptCallback()
   {
      if (this.promptVisible) { console.log(''); }

      this.eventbus.trigger('log:warn:time', 'tjsdoc-plugin-watcher - received SIGINT; shutting down.');

      setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown'));
   }

   /**
    * Set optional parameters. If a change occurs the 'tjsdoc:system:watcher:options:changed' event binding is
    * triggered with the current options state.
    *
    * @param {object} options - Defines optional parameters to set.
    */
   setOptions(options = {})
   {
      if (typeof options !== 'object') { throw new TypeError(`'options' is not an object.`); }

      let optionsChanged = false;

      for (const key in options)
      {
         if (typeof this.options[key] === 'boolean' && typeof options[key] === 'boolean')
         {
            this.options[key] = options[key];
            optionsChanged = true;
         }
      }

      if (optionsChanged)
      {
         this.eventbus.trigger('tjsdoc:system:watcher:options:changed', this.getOptions());
      }
   }

   /**
    * Handles shutting down Watcher and handling control from for regeneration.
    *
    * @param {object}      [options] - Provides options to handle control flow
    *
    * @property {boolean}  [options.regenerate=false] - If true then TJSDoc regenerates all documentation.
    */
   shutdownCallback(options)
   {
      // Pull out any passed in option to regenerate all doc data on shutdown.
      const regenerate = typeof options === 'object' && typeof options.regenerate === 'boolean' ?
       options.regenerate : false;

      if (this.promptVisible) { console.log(''); }

      this.logVerbose(`tjsdoc-plugin-watcher - shutdown requested${regenerate ? ' with regeneration' : ''}.`);

      this.promptVisible = false;

      if (this.readline)
      {
         const rl = this.readline;
         this.readLine = void 0;
         rl.close();
      }

      // Removes any locally added event bindings.
      this.eventProxy.off();

      process.removeListener('SIGINT', this.processInterruptCallback);

      if (this.indexWatcher)
      {
         this.indexWatcher.close();
         this.indexWatcher = void 0;
      }

      if (this.manualWatcher)
      {
         this.manualWatcher.close();
         this.manualWatcher = void 0;
      }

      if (this.testWatcher)
      {
         this.testWatcher.close();
         this.testWatcher = void 0;
      }

      if (this.sourceWatcher)
      {
         this.sourceWatcher.close();
         this.sourceWatcher = void 0;
      }

      this.eventbus.trigger('tjsdoc:system:watcher:stopped');

      this.logVerbose('tjsdoc-plugin-watcher - watching stopped.');

      // Either regenerate all docs or invoke the shutdown event.
      this.eventbus.trigger(regenerate ? 'tjsdoc:system:regenerate:all:docs' : 'tjsdoc:system:shutdown');
   }

   /**
    * Triggers any outbound events if not trigger.
    *
    * @param {*}  args - event arguments
    */
   triggerEvent(...args)
   {
      if (this.options.trigger) { this.eventbus.trigger(...args); }
   }
}

/**
 * Returns `keepAlive` set to true so the event / plugin system stays alive while file watching is enabled for the
 * configured source globs. `typhonjs-plugin-watcher` simply adds additional event bindings that are invoked based
 * on chokidar file watching callbacks. An interactive terminal is also enabled by default allowing user control.
 *
 * @param {PluginEvent} ev - The plugin event.
 */
export function onComplete(ev)
{
   ev.data.keepAlive = true;

   watcher.initialize(ev.data.config);
}

/**
 * Provides eventbus bindings for generating DocObject and AST data for in memory code and files for main and tests.
 *
 * @param {PluginEvent} ev - The plugin event.
 */
export function onPluginLoad(ev)
{
   watcher = new Watcher(ev);
}
