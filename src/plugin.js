import chokidar   from 'chokidar';
import readline   from 'readline';

/**
 * Provides file watching control flow for TJSDoc during the `onComplete` callback.
 */
class Watcher
{
   /**
    * Instantiate Walker then initialize it.
    *
    * @param {EventProxy}  eventbus - The plugin event proxy.
    * @param {object}      pluginOptions - The plugin options.
    */
   constructor(eventbus, pluginOptions)
   {
      /**
       * The plugin event proxy.
       * @type {EventProxy}
       */
      this.eventbus = eventbus;

      /**
       * A local event proxy for Watcher.
       * @type {EventProxy}
       */
      this.eventProxy = eventbus.createEventProxy();

      /**
       * The plugin options.
       * @type {object}
       */
      this.pluginOptions = pluginOptions;

      /**
       * Any Chokidar options taken from plugin options.
       * @type {object}
       */
      this.chokidarOptions = Object.assign({}, pluginOptions.chokidarOptions);

      /**
       * If true then no output is logged; default: false.
       * @type {boolean}
       */
      this.silent = typeof pluginOptions.silent === 'boolean' ? pluginOptions.silent : false;

      /**
       * If true then an interactive terminal is enabled; default: true.
       * @type {boolean}
       */
      this.terminal = typeof pluginOptions.terminal === 'boolean' ? pluginOptions.terminal : true;

      /**
       * If true then additional verbose output is logged; default: false.
       * @type {boolean}
       */
      this.verbose = typeof pluginOptions.verbose === 'boolean' ? pluginOptions.verbose : false;

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

      this.initialize();
   }

   /**
    * Performs setup and initialization of all chokidar watcher instances and the readline terminal.
    */
   initialize()
   {
      /**
       * Tracks the watcher count and when a watcher is started the count is reduced and when `0` is reached then
       * the `tjsdoc:system:watcher:started` is triggered.
       * @type {number}
       */
      let watcherStartCount = 0;

      const watcherStartData = {};

      this.eventProxy.on('tjsdoc:system:watcher:shutdown', this.shutdownCallback, this);

      const config = this.eventbus.triggerSync('tjsdoc:data:config:get');

      if (config._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching source globs: ${JSON.stringify(config._sourceGlobs)}`);

         watcherStartCount++;

         this.sourceWatcher = chokidar.watch(config._sourceGlobs, this.chokidarOptions);

         // On source watcher ready.
         this.sourceWatcher.on('ready', () =>
         {
            // On source file added.
            this.sourceWatcher.on('add', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source addition: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update',
                { action: 'file:added', type: 'source', filePath });
            });

            // On source file changed.
            this.sourceWatcher.on('change', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source changed: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update',
                { action: 'file:changed', type: 'source', filePath });
            });

            // On source file deleted.
            this.sourceWatcher.on('unlink', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - source deletion: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update',
                { action: 'file:deleted', type: 'source', filePath });
            });

            // Get watched files with relative paths
            const files = this.sourceWatcher.getWatched();

            watcherStartData.source = { globs: config._sourceGlobs, files };

            this.log(`tjsdoc-plugin-watcher - watching source files: ${JSON.stringify(files)}`);

            watcherStartCount--;

            if (watcherStartCount === 0) { this.eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData); }
         });
      }

      if (config.test && config.test._sourceGlobs)
      {
         this.log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);

         watcherStartCount++;

         this.testWatcher = chokidar.watch(config.test._sourceGlobs, this.chokidarOptions);

         // On test watcher ready.
         this.testWatcher.on('ready', () =>
         {
            // On test file added.
            this.testWatcher.on('add', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test addition: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update', { action: 'file:added', type: 'test', filePath });
            });

            // On test file changed.
            this.testWatcher.on('change', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test changed: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update',
                { action: 'file:changed', type: 'test', filePath });
            });

            // On test file deleted.
            this.testWatcher.on('unlink', (filePath) =>
            {
               this.logVerbose(`tjsdoc-plugin-watcher - test deletion: ${filePath}`);

               this.eventbus.trigger('tjsdoc:system:watcher:update',
                { action: 'file:deleted', type: 'test', filePath });
            });

            // Get watched files with relative paths
            const files = this.testWatcher.getWatched();

            watcherStartData.test = { globs: config.test._sourceGlobs, files };

            if (this.promptVisible) { this.logNewLine(); }

            this.log(`tjsdoc-plugin-watcher - watching test files: ${JSON.stringify(files)}`);

            watcherStartCount--;

            if (watcherStartCount === 0) { this.eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData); }
         });
      }

      if (config._sourceGlobs || (config.test && config.test._sourceGlobs))
      {
         process.on('SIGINT', this.processInterruptCallback);

         // Set terminal readline loop waiting for the user to type in the commands: `restart` or `exit`.
         if (this.terminal)
         {
            const rlConfig = !this.silent ? { input: process.stdin, output: process.stdout, prompt: '[32mTJSDoc>[0m ' } :
            { input: process.stdin };

            this.readline = readline.createInterface(rlConfig);

            this.readline.on('line', (line) =>
            {
               switch (line.trim())
               {
                  case 'exit':
                     setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown'));
                     break;

                  case 'globs':
                     this.promptVisible = false;

                     if (config._sourceGlobs)
                     {
                        this.log(`tjsdoc-plugin-watcher - watching source globs: ${
                         JSON.stringify(config._sourceGlobs)}`);
                     }

                     if (config.test && config.test._sourceGlobs)
                     {
                        this.log(`tjsdoc-plugin-watcher - watching test globs: ${
                         JSON.stringify(config.test._sourceGlobs)}`);
                     }
                     break;

                  case 'help':
                     if (!this.silent)
                     {
                        this.eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - options:[0m `);
                        this.eventbus.trigger('log:info:raw', `[32m  'exit', shutdown watcher[0m `);
                        this.eventbus.trigger('log:info:raw', `[32m  'globs', list globs being watched[0m `);
                        this.eventbus.trigger('log:info:raw', `[32m  'help', this listing of commands[0m `);
                        this.eventbus.trigger('log:info:raw', `[32m  'regen', regenerate all documentation[0m `);
                        this.eventbus.trigger('log:info:raw', `[32m  'watching', the files being watched[0m `);
                        this.eventbus.trigger('log:info:raw', '');

                        this.promptVisible = true;
                        this.readline.prompt();
                     }
                     break;

                  case 'regen':
                     setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown', { regenerate: true }));
                     break;

                  case 'watching':
                     this.promptVisible = false;

                     if (this.sourceWatcher)
                     {
                        this.log(`tjsdoc-plugin-watcher - watching source files: ${
                         JSON.stringify(this.sourceWatcher.relative())}`);
                     }

                     if (this.testWatcher)
                     {
                        this.log(`tjsdoc-plugin-watcher - watching test files: ${
                         JSON.stringify(this.testWatcher.relative())}`);
                     }
                     break;

                  default:
                     this.log(`tjsdoc-plugin-watcher - unknown command (type 'help' for instructions)`);

                  // eslint-disable-next-line no-fallthrough
                  case '':
                     if (!this.silent)
                     {
                        this.promptVisible = true;
                        this.readline.prompt();
                     }
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
      if (!this.silent)
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
      if (this.verbose && !this.silent)
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
      if (this.promptVisible) { this.logNewLine(); }

      this.eventbus.trigger('log:warn:time', 'tjsdoc-plugin-watcher - received SIGINT; shutting down.');

      setImmediate(() => this.eventbus.trigger('tjsdoc:system:watcher:shutdown'));
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

      this.logVerbose('tjsdoc-plugin-watcher - watcher(s) stopped.');

      // If no more watcher instances are active then trigger the stopped event and if any function is set for
      // `watcherCloseFunction` then execute it.
      this.eventbus.trigger('tjsdoc:system:watcher:stopped');

      this.eventbus.trigger(regenerate ? 'tjsdoc:system:regenerate:all:docs' : 'tjsdoc:system:shutdown');
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

   new Watcher(ev.eventbus, ev.pluginOptions);
}
