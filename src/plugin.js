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

   const config = eventbus.triggerSync('tjsdoc:get:config');

   eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching source globs: ${
    JSON.stringify(config._sourceGlobs)}`);

   const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '[32mTJSDoc>[0m '
   });

   let watcher;
   let watcherCloseFunction;
   let promptVisible = false;

   // Watch all .js files/dirs in process.cwd()
   gaze(config._sourceGlobs, { debounceDelay: 3000 }, (err, newWatcher) =>
   {
      watcher = newWatcher;

      // On file changed
      watcher.on('changed', (filePath) =>
      {
         if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

         eventbus.trigger('log:info:time', `changed: ${filePath}`);

         try
         {
            const result = eventbus.triggerSync('tjsdoc:file:generate:doc:data:throw:errors', filePath);

            if (result)
            {
               eventbus.trigger('log:info:time', `docData: ${JSON.stringify(result.docData)}`);
            }
            else
            {
               eventbus.trigger('log:warn:time', `Failed doc data generation: ${filePath}`);
            }
         }
         catch (err)
         {
            eventbus.trigger('log:warn:time', `Failed doc data generation: ${filePath}`, err);
         }
      });

      // On file added
      watcher.on('added', (filePath) =>
      {
         if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

         eventbus.trigger('log:info:time', `addition: ${filePath}`);
      });

      // On file deleted
      watcher.on('deleted', (filePath) =>
      {
         if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

         eventbus.trigger('log:info:time', `deletion: ${filePath}`);
      });

      watcher.on('end', () =>
      {
         if (typeof watcherCloseFunction === 'function')
         {
            const closeFunction = watcherCloseFunction;
            watcherCloseFunction = void 0;
            setImmediate(closeFunction);
         }
      });

      // Get watched files with relative paths
      const files = watcher.relative();

      eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching files: ${JSON.stringify(files)}`);
   });

   process.on('SIGINT', () =>
   {
      eventbus.trigger('log:warn:time', 'Received SIGINT. Shutting down.');

      if (rl) { rl.close(); }
      if (watcher) { watcher.close(); }

      setImmediate(() => process.exit(0));
   });

   // Set terminal readline loop waiting for the user to type in the commands: `restart` or `exit`.

   rl.on('line', (line) =>
   {
      switch (line.trim())
      {
         case 'exit':
            promptVisible = false;
            watcher.close();
            rl.close();
            process.removeAllListeners('SIGINT');
            setImmediate(() => process.exit(0));
            break;

         case 'globs':
            promptVisible = false;
            eventbus.trigger('log:info:time', `watching globs: ${JSON.stringify(config._sourceGlobs)}`);
            break;

         case 'regen':
         case 'regenerate':
            promptVisible = false;
            setImmediate(() =>
            {
               watcherCloseFunction = () => { eventbus.trigger('tjsdoc:regenerate'); };
               process.removeAllListeners('SIGINT');
               watcher.close();
               rl.close();
            });
            break;

         case 'watching':
            promptVisible = false;
            if (watcher) { eventbus.trigger('log:info:time', `watching files: ${JSON.stringify(watcher.relative())}`); }
            break;

         default:
            promptVisible = true;
            rl.prompt();
            break;
      }
   });
}
