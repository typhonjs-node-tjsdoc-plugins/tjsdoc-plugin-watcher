import gaze       from 'gaze';
import readline   from 'readline';

/**
 * Returns `keepAlive` set to true so the event / plugin system stays alive while file watching is enabled for the
 * configured source globs that continues to incrementally generate documentation.
 *
 * @param {PluginEvent} ev - The plugin event.
 */
export function onComplete(ev)
{
   ev.data.keepAlive = true;

   const eventbus = ev.eventbus;

   const localEventProxy = eventbus.createEventProxy();

   const gazeOptions = Object.assign({ debounceDelay: 500 }, ev.pluginOptions.gazeOptions);

   const silent = typeof ev.pluginOptions.silent === 'boolean' ? ev.pluginOptions.silent : false;

   const terminal = typeof ev.pluginOptions.terminal === 'boolean' ? ev.pluginOptions.terminal : true;

   const verbose = typeof ev.pluginOptions.verbose === 'boolean' ? ev.pluginOptions.verbose : false;

   let watcherStartCount = 0;
   let watcherCloseCount = 0;
   const watcherStartData = {};

   const log = (message) =>
   {
      if (!silent) { eventbus.trigger('log:info:time', message); }
   };

   const logNewLine = () => { console.log(''); };

   const logVerbose = (message) =>
   {
      if (verbose && !silent) { eventbus.trigger('log:info:time', message); }
   };

   const logVerboseRaw = (message) =>
   {
      if (verbose && !silent) { eventbus.trigger('log:info:raw', message); }
   };

   let sourceWatcher, testWatcher;
   let rl;
   let watcherCloseFunction;
   let promptVisible = false;

   const processInterruptCallback = () =>
   {
      if (promptVisible) { logNewLine(); }

      eventbus.trigger('log:warn:time', 'tjsdoc-plugin-watcher - received SIGINT; shutting down.');

      setImmediate(() => eventbus.trigger('tjsdoc:system:watcher:shutdown'));
   };

   const shutdownCallback = (data) =>
   {
      const regenerate = typeof data === 'object' && typeof data.regenerate === 'boolean' ? data.regenerate : false;

      if (promptVisible) { logNewLine(); }

      logVerbose(`tjsdoc-plugin-watcher - shutdown requested${regenerate ? ' with regeneration' : ''}.`);

      promptVisible = false;

      if (rl) { rl.close(); }

      rl = void 0;

      localEventProxy.off();

      process.removeListener('SIGINT', processInterruptCallback);

      if (regenerate) { watcherCloseFunction = () => eventbus.trigger('tjsdoc:system:regenerate:all:docs'); }

      // If `testWatcher` exists it will close `sourceWatcher` otherwise potentially invoke `sourceWatcher.close()`.
      if (testWatcher)
      {
         testWatcher.close();
      }
      else if (sourceWatcher)
      {
         sourceWatcher.close();
      }
   };

   localEventProxy.on('tjsdoc:system:watcher:shutdown', shutdownCallback);

   if (terminal)
   {
      const rlConfig = !silent ? { input: process.stdin, output: process.stdout, prompt: '[32mTJSDoc>[0m ' } :
      { input: process.stdin };

      rl = readline.createInterface(rlConfig);
   }

   const config = eventbus.triggerSync('tjsdoc:data:config:get');

   if (config._sourceGlobs)
   {
      log(`tjsdoc-plugin-watcher - watching source globs: ${JSON.stringify(config._sourceGlobs)}`);

      watcherStartCount++;
      watcherCloseCount++;

      // Watch all source files.
      gaze(config._sourceGlobs, gazeOptions, (err, watcher) =>
      {
         sourceWatcher = watcher;

         // On source file added.
         sourceWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - source addition: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'source', filePath });
         });

         // On source file changed.
         sourceWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - source changed: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'source', filePath });
         });

         // On source file deleted.
         sourceWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - source deletion: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'source', filePath });
         });

         // On source watcher ending.
         sourceWatcher.on('end', () =>
         {
            eventbus.trigger('tjsdoc:system:watcher:stopped', { type: 'source' });

            logVerbose('tjsdoc-plugin-watcher - source watcher stopped.');

            sourceWatcher = void 0;

            watcherCloseCount--;

            if (watcherCloseCount === 0)
            {
               eventbus.trigger('tjsdoc:system:watcher:stopped');
            }

            if (typeof watcherCloseFunction === 'function')
            {
               const closeFunction = watcherCloseFunction;

               watcherCloseFunction = void 0;

               logVerbose('tjsdoc-plugin-watcher - shutdown callback invoked.');

               setImmediate(closeFunction);
            }
         });

         watcherStartData.source = { globs: config._sourceGlobs, files: sourceWatcher.watched() };

         // Get watched files with relative paths
         const files = sourceWatcher.relative();

         if (promptVisible) { logNewLine(); }

         log(`tjsdoc-plugin-watcher - watching source files: ${JSON.stringify(files)}`);

         watcherStartCount--;

         if (watcherStartCount === 0) { eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData); }
      });
   }

   if (config.test && config.test._sourceGlobs)
   {
      log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);

      watcherStartCount++;
      watcherCloseCount++;

      // Watch all test files.
      gaze(config.test._sourceGlobs, gazeOptions, (err, watcher) =>
      {
         testWatcher = watcher;

         // On file added
         testWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - test addition: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'test', filePath });
         });

         // On file changed
         testWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - test changed: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'test', filePath });
         });

         // On file deleted
         testWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { logVerboseRaw(''); }

            logVerbose(`tjsdoc-plugin-watcher - test deletion: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'test', filePath });
         });

         testWatcher.on('end', () =>
         {
            eventbus.trigger('tjsdoc:system:watcher:stopped', { type: 'test' });

            logVerbose('tjsdoc-plugin-watcher - test watcher stopped.');

            testWatcher = void 0;

            watcherCloseCount--;

            if (watcherCloseCount === 0)
            {
               eventbus.trigger('tjsdoc:system:watcher:stopped');
            }

            if (sourceWatcher) { sourceWatcher.close(); }
         });

         if (promptVisible) { logNewLine(); }

         watcherStartData.test = { globs: config.test._sourceGlobs, files: testWatcher.watched() };

         // Get watched files with relative paths
         const files = testWatcher.relative();

         log(`tjsdoc-plugin-watcher - watching test files: ${JSON.stringify(files)}`);

         watcherStartCount--;

         if (watcherStartCount === 0) { eventbus.trigger('tjsdoc:system:watcher:started', watcherStartData); }
      });
   }

   if (config._sourceGlobs || (config.test && config.test._sourceGlobs))
   {
      process.on('SIGINT', processInterruptCallback);

      // Set terminal readline loop waiting for the user to type in the commands: `restart` or `exit`.

      if (rl)
      {
         rl.on('line', (line) =>
         {
            switch (line.trim())
            {
               case 'exit':
                  setImmediate(() => eventbus.trigger('tjsdoc:system:watcher:shutdown'));
                  break;

               case 'globs':
                  promptVisible = false;

                  if (config._sourceGlobs)
                  {
                     log(`tjsdoc-plugin-watcher - watching source globs: ${JSON.stringify(config._sourceGlobs)}`);
                  }

                  if (config.test && config.test._sourceGlobs)
                  {
                     log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);
                  }
                  break;

               case 'help':
                  if (!silent)
                  {
                     eventbus.trigger('log:info:raw', `[32mtjsdoc-plugin-watcher - options:[0m `);
                     eventbus.trigger('log:info:raw', `[32m  'exit', shutdown watcher[0m `);
                     eventbus.trigger('log:info:raw', `[32m  'globs', list globs being watched[0m `);
                     eventbus.trigger('log:info:raw', `[32m  'help', this listing of commands[0m `);
                     eventbus.trigger('log:info:raw', `[32m  'regen', regenerate all documentation[0m `);
                     eventbus.trigger('log:info:raw', `[32m  'watching', the files being watched[0m `);
                     eventbus.trigger('log:info:raw', '');

                     promptVisible = true;
                     rl.prompt();
                  }
                  break;

               case 'regen':
                  setImmediate(() => eventbus.trigger('tjsdoc:system:watcher:shutdown', { regenerate: true }));
                  break;

               case 'watching':
                  promptVisible = false;

                  if (sourceWatcher)
                  {
                     log(`tjsdoc-plugin-watcher - watching source files: ${JSON.stringify(sourceWatcher.relative())}`);
                  }

                  if (testWatcher)
                  {
                     log(`tjsdoc-plugin-watcher - watching test files: ${JSON.stringify(testWatcher.relative())}`);
                  }
                  break;

               default:
                  log(`tjsdoc-plugin-watcher - unknown command (type 'help' for instructions)`);

               // eslint-disable-next-line no-fallthrough
               case '':
                  if (!silent)
                  {
                     promptVisible = true;
                     rl.prompt();
                  }

                  break;
            }
         });

         eventbus.trigger('tjsdoc:system:watcher:initialized');
      }
   }
   else
   {
      log('tjsdoc-plugin-watcher: no main source or tests to watch.');
   }
}
