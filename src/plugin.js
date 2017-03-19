import chokidar   from 'chokidar';
import fs         from 'fs';
import path       from 'path';
import readline   from 'readline';

/**
 * Provides file watching control flow for TJSDoc during the `onComplete` callback.
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
       * The target project TJSDocConfig object.
       * @type {TJSDocConfig}
       */
      this.config = ev.data.config;

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
       * While true no runtime watcher events are triggered or logging occurs; default: false
       * @type {boolean}
       */
      this.paused = typeof this.pluginOptions.paused === 'boolean' ? this.pluginOptions.paused : false;

      /**
       * If true then no output is logged; default: false.
       * @type {boolean}
       */
      this.silent = typeof this.pluginOptions.silent === 'boolean' ? this.pluginOptions.silent : false;

      /**
       * If true then an interactive terminal is enabled; default: true.
       * @type {boolean}
       */
      this.terminal = typeof this.pluginOptions.terminal === 'boolean' ? this.pluginOptions.terminal : true;

      /**
       * If true then additional verbose output is logged; default: false.
       * @type {boolean}
       */
      this.verbose = typeof this.pluginOptions.verbose === 'boolean' ? this.pluginOptions.verbose : false;

      /**
       * Tracks the terminal prompt when it is visible.
       * @type {boolean}
       */
      this.promptVisible = false;

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

      this.initialize(ev.data.config);
   }

   /**
    * Get the currently watched source and test glob patterns.
    *
    * @returns {{source: Array, test: Array}}
    */
   getGlobs()
   {
      return {
         source: this.config._sourceGlobs ? this.config._sourceGlobs : [],
         test: this.config.test && this.config.test._sourceGlobs ? this.config.test._sourceGlobs : []
      };
   }

   /**
    * Gets the current user settable options.
    *
    * @returns {{paused: boolean, silent: boolean, verbose: boolean}}
    */
   getOptions()
   {
      return { paused: this.paused, silent: this.silent, verbose: this.verbose };
   }

   /**
    * Get the currently watched globs and files.
    *
    * @param {object}      [options] - Optional parameters.
    * @property {boolean}  [options.relative] - If true then all directory paths in `files` is made relative to CWD.
    *
    * @returns {{source: {globs: Array, files: {}}, test: {globs: Array, files: {}}}}
    */
   getWatching(options)
   {
      const sourceGlobs = this.config._sourceGlobs ? this.config._sourceGlobs : [];
      const sourceFiles = this.sourceWatcher ? this.sourceWatcher.getWatched() : {};
      const testGlobs = this.config.test && this.config.test._sourceGlobs ? this.config.test._sourceGlobs : [];
      const testFiles = this.testWatcher ? this.testWatcher.getWatched() : {};

      // Filter absolute paths converting them to relative.
      if (typeof options === 'object' && typeof options.relative === 'boolean' && options.relative)
      {
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

      for (const reg of this.config._excludes)
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
       * Tracks the watcher count and when a watcher is started the count is reduced and when `0` is reached then
       * the `tjsdoc:system:watcher:started` event is triggered.
       * @type {number}
       */
      let watcherStartCount = 0;

      const watcherStartData = { source: { globs: [], files: {} }, test: { globs: [], files: {} } };

      this.eventProxy.on('tjsdoc:system:watcher:globs:get', this.getGlobs, this);
      this.eventProxy.on('tjsdoc:system:watcher:options:get', this.getOptions, this);
      this.eventProxy.on('tjsdoc:system:watcher:options:set', this.setOptions, this);
      this.eventProxy.on('tjsdoc:system:watcher:shutdown', this.shutdownCallback, this);
      this.eventProxy.on('tjsdoc:system:watcher:watching:get', this.getWatching, this);

      if (config._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching source globs: ${JSON.stringify(config._sourceGlobs)}`);

         watcherStartCount++;

         // Create source watcher providing a custom ignored function which uses config._includes and config._excludes
         // for filtering files.
         this.sourceWatcher = chokidar.watch(config._sourceGlobs,
          Object.assign({ ignored: this.ignoredSource.bind(this) }, this.chokidarOptions));

         // On source watcher ready.
         this.sourceWatcher.on('ready', () =>
         {
            // On source file added.
            this.sourceWatcher.on('add', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source addition: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:add', type: 'source', path });
            });

            // On source file changed.
            this.sourceWatcher.on('change', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source changed: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:change', type: 'source', path });
            });

            // On source file deleted.
            this.sourceWatcher.on('unlink', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source unlinked: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:unlink', type: 'source', path });
            });

            // Set watcher start data (globs / files).
            watcherStartData.source = { globs: config._sourceGlobs, files: this.sourceWatcher.getWatched() };

            watcherStartCount--;

            if (watcherStartCount === 0)
            {
               this.log(`tjsdoc-plugin-watcher - type 'help' for options.`);

               this.eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData);
            }
         });
      }

      if (config.test && config.test._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);

         watcherStartCount++;

         // Create test watcher providing a custom ignored function which uses config.test._includes and
         // config.test._excludes for filtering files.
         this.testWatcher = chokidar.watch(config.test._sourceGlobs,
          Object.assign({ ignored: this.ignoredTest.bind(this) }, this.chokidarOptions));

         // On test watcher ready.
         this.testWatcher.on('ready', () =>
         {
            // On test file added.
            this.testWatcher.on('add', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test addition: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:add', type: 'test', path });
            });

            // On test file changed.
            this.testWatcher.on('change', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test changed: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:change', type: 'test', path });
            });

            // On test file deleted.
            this.testWatcher.on('unlink', (path) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test unlinked: ${path}`);

               this.triggerEvent('tjsdoc:system:watcher:update', { action: 'file:unlink', type: 'test', path });
            });

            // Set watcher start data (globs / files).
            watcherStartData.test = { globs: config.test._sourceGlobs, files: this.testWatcher.getWatched() };

            watcherStartCount--;

            if (watcherStartCount === 0)
            {
               this.log(`tjsdoc-plugin-watcher - type 'help' for options.`);

               this.eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData);
            }
         });
      }

      if (config._sourceGlobs || (config.test && config.test._sourceGlobs))
      {
         process.on('SIGINT', this.processInterruptCallback);

         // Set terminal readline loop waiting for the user to type in the commands: `exit`, `globs`, `help`, `pause`,
         // `regen`, `silent`, `status`, `verbose`, `watching`.
         if (this.terminal)
         {
            const rlConfig = !this.silent ?
            { input: process.stdin, output: process.stdout, prompt: '[32mTJSDoc>[0m ' } : { input: process.stdin };

            this.readline = readline.createInterface(rlConfig);

            const showPrompt = () =>
            {
               if (!this.silent)
               {
                  this.promptVisible = true;
                  this.readline.prompt();
               }
            };

            this.readline.on('line', (line) =>
            {
               this.promptVisible = false;

               const lineSplit = line.trim().split(' ');

               switch (lineSplit[0])
               {
                  case 'exit':
                     setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown'));
                     break;

                  case 'globs':
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
                     break;

                  case 'help':
                     this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - options:[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'exit', shutdown watcher[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'globs', list globs being watched[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'help', this listing of commands[0m`);
                     this.eventbus.trigger('log:info:raw',
                      `[32m  'pause [on/off]', pauses / unpauses watcher events & logging[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'regen', regenerate all documentation[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'silent [on/off]', turns on / off logging[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'status', logs current optional status[0m`);
                     this.eventbus.trigger('log:info:raw',
                      `[32m  'verbose [on/off]', turns on / off verbose logging[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  'watching', the files being watched[0m`);

                     showPrompt();
                     break;

                  case 'pause':
                     if (typeof lineSplit[1] === 'string')
                     {
                        switch (lineSplit[1])
                        {
                           case 'off':
                              this.paused = false;
                              break;

                           case 'on':
                              this.paused = true;
                              break;

                           default:
                              this.eventbus.trigger('log:info:raw',
                               `[32mtjsdoc-plugin-watcher - pause command malformed; must be 'pause [on/off]'[0m`);
                        }
                     }
                     else
                     {
                        this.eventbus.trigger('log:info:raw',
                         `[32mtjsdoc-plugin-watcher - pause command malformed; must be 'pause [on/off]'[0m`);
                     }

                     showPrompt();
                     break;

                  case 'regen':
                     setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown', { regenerate: true }));
                     break;

                  case 'silent':
                     if (typeof lineSplit[1] === 'string')
                     {
                        switch (lineSplit[1])
                        {
                           case 'off':
                              this.silent = false;
                              break;

                           case 'on':
                              this.silent = true;
                              break;

                           default:
                              this.eventbus.trigger('log:info:raw',
                               `[32mtjsdoc-plugin-watcher - silent command malformed; must be 'silent [on/off]'[0m`);
                        }
                     }
                     else
                     {
                        this.eventbus.trigger('log:info:raw',
                         `[32mtjsdoc-plugin-watcher - silent command malformed; must be 'pause [on/off]'[0m`);
                     }

                     showPrompt();
                     break;

                  case 'status':
                     this.eventbus.trigger('log:info:raw', '[32mtjsdoc-plugin-watcher - status:[0m');
                     this.eventbus.trigger('log:info:raw', `[32m  paused: ${this.paused}[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  silent: ${this.silent}[0m`);
                     this.eventbus.trigger('log:info:raw', `[32m  verbose: ${this.verbose}[0m`);
                     this.eventbus.trigger('log:info:raw', '');

                     showPrompt();
                     break;

                  case 'verbose':
                     if (typeof lineSplit[1] === 'string')
                     {
                        switch (lineSplit[1])
                        {
                           case 'off':
                              this.verbose = false;
                              break;

                           case 'on':
                              this.verbose = true;
                              break;

                           default:
                              this.eventbus.trigger('log:info:raw',
                               `[32mtjsdoc-plugin-watcher - verbose command malformed; must be 'verbose [on/off]'[0m`);
                        }
                     }
                     else
                     {
                        this.eventbus.trigger('log:info:raw',
                         `[32mtjsdoc-plugin-watcher - verbose command malformed; must be 'verbose [on/off]'[0m`);
                     }

                     showPrompt();
                     break;

                  case 'watching':
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
                     break;

                  default:
                     this.eventbus.trigger('log:info:raw',
                      `[32mtjsdoc-plugin-watcher - unknown command (type 'help' for instructions)[0m`);

                  // eslint-disable-next-line no-fallthrough
                  case '':
                     showPrompt();
                     break;
               }
            });

            const globData = {};

            if (config._sourceGlobs) { globData.source = config._sourceGlobs; }

            if (config.test && config.test._sourceGlobs) { globData.test = config.test._sourceGlobs; }

            this.eventbus.trigger('tjsdoc:system:watcher:initialized', globData);
         }
      }
      else
      {
         this.log('tjsdoc-plugin-watcher: no main source or tests to watch.');
      }
   }

   /**
    * Outputs a log message if not `silent`. If the terminal prompt is visible then a new line is output first.
    *
    * @param {string}   message - The log message.
    */
   log(message)
   {
      if (!this.silent && !this.paused)
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
      if (this.verbose && !this.silent && !this.paused)
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
    * Set optional parameters. All parameters are off by default.
    *
    * @param {object} options - Defines optional parameters to set.
    */
   setOptions(options = {})
   {
      if (typeof options !== 'object') { throw new TypeError(`'options' is not an object.`); }

      if (typeof options.paused === 'boolean') { this.paused = options.paused; }
      if (typeof options.silent === 'boolean') { this.silent = options.silent; }
      if (typeof options.verbose === 'boolean') { this.verbose = options.verbose; }
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

      this.logVerbose(`tjsdoc-plugin-watcher - shutdown requested${regenerate ? ' with regeneration' : ''}.`);

      this.promptVisible = false;

      if (this.readline) { this.readline.close(); }

      this.readline = void 0;

      // Removes any locally added event bindings.
      this.eventProxy.off();

      process.removeListener('SIGINT', this.processInterruptCallback);

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
    * Triggers any outbound events if not paused.
    *
    * @param {*}  args - event arguments
    */
   triggerEvent(...args)
   {
      if (!this.paused) { this.eventbus.trigger(...args); }
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

   new Watcher(ev);
}
