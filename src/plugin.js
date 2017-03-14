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

   const log = (message) =>
   {
      if (!silent) { eventbus.trigger('log:info:time', message); }
   };

   const logVerbose = (message) =>
   {
      if (verbose && !silent) { eventbus.trigger('log:info:time', message); }
   };

   let sourceWatcher, testWatcher;
   let rl;
   let watcherCloseFunction;
   let promptVisible = false;

   const processInterruptCallback = () =>
   {
      eventbus.trigger('log:warn:time', 'Received SIGINT. Shutting down.');

      if (rl) { rl.close(); }
      if (sourceWatcher) { sourceWatcher.close(); }
      if (testWatcher) { testWatcher.close(); }

      setImmediate(() => process.exit(0));
   };

   const shutdownCallback = () =>
   {
      log('tjsdoc-plugin-watcher - shutdown requested.');
      promptVisible = false;

      if (rl) { rl.close(); }
      if (sourceWatcher) { sourceWatcher.close(); }
      if (testWatcher) { testWatcher.close(); }

      process.removeListener('SIGINT', processInterruptCallback);

      localEventProxy.off();
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

      // Watch all source files.
      gaze(config._sourceGlobs, gazeOptions, (err, watcher) =>
      {
         sourceWatcher = watcher;

         // On source file changed.
         sourceWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`source changed: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'source', filePath });
         });

         // On source file added.
         sourceWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`source addition: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'source', filePath });
         });

         // On source file deleted.
         sourceWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`source deletion: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'source', filePath });
         });

         // On source watcher ending.
         sourceWatcher.on('end', () =>
         {
            eventbus.trigger('tjsdoc:system:watcher:stopped', { type: 'source' });

            if (typeof watcherCloseFunction === 'function')
            {
               const closeFunction = watcherCloseFunction;
               watcherCloseFunction = void 0;
               setImmediate(closeFunction);
            }
         });

         if (promptVisible) { logVerbose(''); }

         // Get watched files with relative paths
         const files = sourceWatcher.relative();

         log(`tjsdoc-plugin-watcher - watching source files: ${JSON.stringify(files)}`);

         eventbus.trigger('tjsdoc:system:watcher:started', { type: 'source' });
      });
   }

   if (config.test && config.test._sourceGlobs)
   {
      log(`tjsdoc-plugin-watcher - watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);

      // Watch all test files.
      gaze(config.test._sourceGlobs, gazeOptions, (err, watcher) =>
      {
         testWatcher = watcher;

         // On file changed
         testWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`test changed: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'test', filePath });
         });

         // On file added
         testWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`test addition: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'test', filePath });
         });

         // On file deleted
         testWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { logVerbose(''); }

            logVerbose(`test deletion: ${filePath}`);

            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'test', filePath });
         });

         testWatcher.on('end', () =>
         {
            eventbus.trigger('tjsdoc:system:watcher:stopped', { type: 'test' });

            if (typeof watcherCloseFunction === 'function' && sourceWatcher)
            {
               sourceWatcher.close();
            }
         });

         if (promptVisible) { logVerbose(''); }

         // Get watched files with relative paths
         const files = testWatcher.relative();

         log(`tjsdoc-plugin-watcher - watching test files: ${JSON.stringify(files)}`);

         eventbus.trigger('tjsdoc:system:watcher:started', { type: 'test' });
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
                  promptVisible = false;

                  rl.close();
                  if (sourceWatcher) { sourceWatcher.close(); }
                  if (testWatcher) { testWatcher.close(); }

                  process.removeListener('SIGINT', processInterruptCallback);

                  setImmediate(() => process.exit(0));
                  break;

               case 'globs':
                  promptVisible = false;

                  if (config._sourceGlobs)
                  {
                     log(`watching source globs: ${JSON.stringify(config._sourceGlobs)}`);
                  }

                  if (config.test && config.test._sourceGlobs)
                  {
                     log(`watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);
                  }
                  break;

               case 'regen':
               case 'regenerate':
                  promptVisible = false;

                  setImmediate(() =>
                  {
                     watcherCloseFunction = () =>
                     {
                        eventbus.trigger('tjsdoc:system:regenerate:all:docs');
                     };

                     process.removeAllListeners('SIGINT');

                     // If `testWatcher` exists it will close `sourceWatcher` otherwise
                     if (testWatcher)
                     {
                        testWatcher.close();
                     }
                     else if (sourceWatcher)
                     {
                        sourceWatcher.close();
                     }

                     rl.close();
                  });
                  break;

               case 'watching':
                  promptVisible = false;

                  if (sourceWatcher)
                  {
                     log(`watching source files: ${JSON.stringify(sourceWatcher.relative())}`);
                  }

                  if (testWatcher)
                  {
                     log(`watching test files: ${JSON.stringify(testWatcher.relative())}`);
                  }
                  break;

               default:
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
