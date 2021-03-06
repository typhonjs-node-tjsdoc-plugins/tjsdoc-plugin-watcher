import fs            from 'fs-extra';
import mainEventbus  from 'backbone-esnext-eventbus';
import path          from 'path';
import Util          from 'tjsdoc-test-utils';

/**
 * `backbone-esnext-eventbus is remapped in `.babelrc` for dev-test NPM script to point to
 * `../../typhonjs-node-tjsdoc/tjsdoc/node_modules/backbone-esnext-eventbus/dist/eventbus.js` to link it to executing
 * eventbus from `../../typhonjs-node-tjsdoc/tjsdoc/src/TJSDoc.js`.
 */

const s_DEV_TARGET =
{
   name: 'babylon',
   cli: path.resolve('../../typhonjs-node-tjsdoc/tjsdoc-babylon/src/TJSDocBabylonCLI.js'),
   tjsdoc: path.resolve('../../typhonjs-node-tjsdoc/tjsdoc-babylon/src/TJSDocBabylon.js'),
   runtime: path.resolve('../../typhonjs-node-tjsdoc/tjsdoc-babylon/src/TJSDocBabylon.js'),
   publisher: path.resolve('../../typhonjs-node-tjsdoc/tjsdoc-publisher-static-html/src/Publisher.js'),
   type: 'ecmascript'
};

const s_DEBUG_LOG = false;

const log = (message) =>
{
   if (s_DEBUG_LOG) { console.log(message); }
};

const s_VERIFY_INIT_INDEX = '["./README.md"]';
const s_VERIFY_INIT_MANUAL = '["./test/fixture/ManualTest.md"]';
const s_VERIFY_INIT_SOURCE = '["src/**/*","test/dest/main/**/*"]';
const s_VERIFY_INIT_TEST = '["test/src/**/*","test/dest/test/**/*"]';

const s_VERIFY_START_INDEX = '{"globs":"./README.md","files":{"":["README.md"]}}';
const s_VERIFY_START_MANUAL = '{"globs":["./test/fixture/ManualTest.md"],"files":{"test/fixture":["ManualTest.md"]}}';
const s_VERIFY_START_SOURCE = '{"globs":["src/**/*","test/dest/main/**/*"],"files":{"src":["ManualWatchGroup.js","WatchGroup.js","Watcher.js"]}}';
const s_VERIFY_START_TEST = '{"globs":["test/src/**/*","test/dest/test/**/*"],"files":{"test/src":["Watcher.js"]}}';

/**
 * @test {Watcher}
 */
describe('tjsdoc-plugin-watcher', () =>
{
   const eventProxy = mainEventbus.createEventProxy();

   afterEach(() =>
   {
      eventProxy.off();
   });

   after(() =>
   {
      fs.emptyDirSync('./test/dest/main');
      fs.emptyDirSync('./test/dest/test');
   });

   it('perform changes - add, change, delete', (done) =>
   {
      s_PERFORM_INIT_TEST(eventProxy, true,
       () => s_PERFORM_CHANGES(eventProxy, () => { eventProxy.trigger('tjsdoc:system:watcher:shutdown'); }));

      eventProxy.on('tjsdoc:system:shutdown', () => done());

      Util.invoke(s_DEV_TARGET, './.tjsdocrc', { modConfig: false, silent: false });
   });

   it('(again) perform changes - add, change, delete', (done) =>
   {
      s_PERFORM_INIT_TEST(eventProxy, true,
       () => s_PERFORM_CHANGES(eventProxy, () => { eventProxy.trigger('tjsdoc:system:watcher:shutdown'); }));

      eventProxy.on('tjsdoc:system:shutdown', () => done());

      Util.invoke(s_DEV_TARGET, './.tjsdocrc', { modConfig: false, silent: false });
   });

   it('(regen x5) - perform changes - add, change, delete', (done) =>
   {
      let regenCount = 5;

      const regenCallback = () =>
      {
         regenCount--;

         if (regenCount >= 0)
         {
            eventProxy.off();

            s_PERFORM_INIT_TEST(eventProxy, false, () => s_PERFORM_CHANGES(eventProxy, regenCallback));

            eventProxy.trigger('tjsdoc:system:watcher:shutdown', { regenerate: true });
         }
         else
         {
            eventProxy.on('tjsdoc:system:shutdown', () => done());

            eventProxy.trigger('tjsdoc:system:watcher:shutdown');
         }
      };

      s_PERFORM_INIT_TEST(eventProxy, true, () => s_PERFORM_CHANGES(eventProxy, regenCallback));

      Util.invoke(s_DEV_TARGET, './.tjsdocrc', { modConfig: false, silent: false });
   });

   it('Options (trigger=false), add, change, delete', (done) =>
   {
      const config = JSON.parse(fs.readFileSync('./.tjsdocrc').toString());

      config.plugins = [{ name: './src/Watcher.js', options: { trigger: false } }];

      s_PERFORM_INIT_TEST(eventProxy, true, () =>
      {
         eventProxy.on('tjsdoc:system:watcher:update', () => { throw new Error('triggering should be off.'); });

         // Since the watcher is not triggering s_PERFORM_CHANGES will throw an error!
         setTimeout(() =>
         {
            fs.outputFileSync('./test/dest/main/source.js', 'new');
            fs.outputFileSync('./test/dest/test/test.js', 'new');
         }, 200);

         setTimeout(() =>
         {
            fs.outputFileSync('./test/dest/main/source2.js', 'mod!');
            fs.outputFileSync('./test/dest/test/test2.js', 'mod!');
         }, 400);

         setTimeout(() =>
         {
            fs.removeSync('./test/dest/main/source2.js');
            fs.removeSync('./test/dest/test/test2.js');
         }, 600);

         setTimeout(() =>
         {
            eventProxy.trigger('tjsdoc:system:watcher:shutdown');
         }, 1000);
      });

      eventProxy.on('tjsdoc:system:shutdown', () => done());

      Util.invoke(s_DEV_TARGET, config, { modConfig: false, silent: false });
   });

   it('Options (silent=true), add, change, delete', (done) =>
   {
      const config = JSON.parse(fs.readFileSync('./.tjsdocrc').toString());

      eventProxy.on('log:info:time', () => { throw new Error(`Received 'log:info:time: event in 'silent' mode.`); });

      config.plugins = [{ name: './src/Watcher.js', options: { silent: true } }];

      s_PERFORM_INIT_TEST(eventProxy, true,
       () => s_PERFORM_CHANGES(eventProxy, () => { eventProxy.trigger('tjsdoc:system:watcher:shutdown'); }));

      eventProxy.on('tjsdoc:system:shutdown', () => done());

      Util.invoke(s_DEV_TARGET, config, { modConfig: false, silent: false });
   });

   it('Options (verbose=true), add, change, delete', (done) =>
   {
      const config = JSON.parse(fs.readFileSync('./.tjsdocrc').toString());

      const verifyInfo =
      {
         watchingIndex: false,
         watchingManual: false,
         watchingSource: false,
         watchingTest: false,
         helpMessage: false,
         sourceAdded: false,
         testAdded: false,
         sourceChanged: false,
         testChanged: false,
         sourceUnlinked: false,
         testUnlinked: false,
         shutdownRequested: false,
         watchersStopped: false
      };

      // Verifies that all verbose logging messages are received.
      eventProxy.on('log:info:time', (message) =>
      {
         if (message.startsWith('tjsdoc-plugin-watcher - watching index: ./README.md')) { verifyInfo.watchingIndex = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - watching manual globs: ["./test/fixture/ManualTest.md"]')) { verifyInfo.watchingManual = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - watching source globs: ["src/**/*","test/dest/main/**/*"]')) { verifyInfo.watchingSource = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - watching test globs: ["test/src/**/*","test/dest/test/**/*"]')) { verifyInfo.watchingTest = true; }
         if (message.startsWith(`tjsdoc-plugin-watcher - type 'help' for options.`)) { verifyInfo.helpMessage = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - source addition')) { verifyInfo.sourceAdded = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - test addition')) { verifyInfo.testAdded = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - source changed')) { verifyInfo.sourceChanged = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - test changed')) { verifyInfo.testChanged = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - source unlinked')) { verifyInfo.sourceUnlinked = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - test unlinked')) { verifyInfo.testUnlinked = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - shutdown requested')) { verifyInfo.shutdownRequested = true; }
         if (message.startsWith('tjsdoc-plugin-watcher - watching stopped')) { verifyInfo.watchersStopped = true; }
      });

      config.plugins = [{ name: './src/Watcher.js', options: { verbose: true } }];

      s_PERFORM_INIT_TEST(eventProxy, true,
       () => s_PERFORM_CHANGES(eventProxy, () => { eventProxy.trigger('tjsdoc:system:watcher:shutdown'); }));

      eventProxy.on('tjsdoc:system:shutdown', () =>
      {
         for (const key in verifyInfo)
         {
            if (!verifyInfo[key])
            {
               throw new Error(`Did not receive all verbose log messages, verifyInfo: ${JSON.stringify(verifyInfo)}`);
            }
         }

         done();
      });

      Util.invoke(s_DEV_TARGET, config, { modConfig: false, silent: false });
   });

   it('Event bindings', (done) =>
   {
      s_PERFORM_INIT_TEST(eventProxy, true, () =>
      {
         const globs = eventProxy.triggerSync('tjsdoc:system:watcher:globs:get');
         let options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         const watching = eventProxy.triggerSync('tjsdoc:system:watcher:watching:get', { relative: true });

         let currentOptions = {};

         eventProxy.on('tjsdoc:system:watcher:options:changed', (newOptions) => { currentOptions = newOptions; });

         Util.assert.strictEqual(JSON.stringify(globs), '{"index":["./README.md"],"manual":["./test/fixture/ManualTest.md"],"source":["src/**/*","test/dest/main/**/*"],"test":["test/src/**/*","test/dest/test/**/*"]}');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":false,"trigger":true,"verbose":false}');
         Util.assert.strictEqual(JSON.stringify(watching), '{"index":{"globs":["./README.md"],"files":{"":["README.md"]}},"manual":{"globs":["./test/fixture/ManualTest.md"],"files":{"test/fixture":["ManualTest.md"]}},"source":{"globs":["src/**/*","test/dest/main/**/*"],"files":{"src":["ManualWatchGroup.js","WatchGroup.js","Watcher.js"]}},"test":{"globs":["test/src/**/*","test/dest/test/**/*"],"files":{"test/src":["Watcher.js"]}}}');

         eventProxy.triggerSync('tjsdoc:system:watcher:options:set', { trigger: false });
         options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":false,"trigger":false,"verbose":false}');
         Util.assert.strictEqual(JSON.stringify(currentOptions), '{"silent":false,"trigger":false,"verbose":false}');

         eventProxy.triggerSync('tjsdoc:system:watcher:options:set', { silent: true });
         options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":true,"trigger":false,"verbose":false}');
         Util.assert.strictEqual(JSON.stringify(currentOptions), '{"silent":true,"trigger":false,"verbose":false}');

         eventProxy.triggerSync('tjsdoc:system:watcher:options:set', { verbose: true });
         options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":true,"trigger":false,"verbose":true}');
         Util.assert.strictEqual(JSON.stringify(currentOptions), '{"silent":true,"trigger":false,"verbose":true}');

         eventProxy.triggerSync('tjsdoc:system:watcher:options:set', { trigger: true, silent: false });
         options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":false,"trigger":true,"verbose":true}');
         Util.assert.strictEqual(JSON.stringify(currentOptions), '{"silent":false,"trigger":true,"verbose":true}');

         eventProxy.triggerSync('tjsdoc:system:watcher:options:set', { trigger: true, verbose: false });
         options = eventProxy.triggerSync('tjsdoc:system:watcher:options:get');
         Util.assert.strictEqual(JSON.stringify(options), '{"silent":false,"trigger":true,"verbose":false}');
         Util.assert.strictEqual(JSON.stringify(currentOptions), '{"silent":false,"trigger":true,"verbose":false}');

         eventProxy.trigger('tjsdoc:system:watcher:shutdown');
      });

      eventProxy.on('tjsdoc:system:shutdown', () => done());

      Util.invoke(s_DEV_TARGET, './.tjsdocrc', { modConfig: false, silent: false });
   });
});

const s_PERFORM_INIT_TEST = (eventProxy, testInit, doneCallback) =>
{
   let initialized = false;

   fs.ensureDirSync('./test/dest/main');
   fs.emptyDirSync('./test/dest/main');

   fs.ensureDirSync('./test/dest/test');
   fs.emptyDirSync('./test/dest/test');

   eventProxy.on('tjsdoc:system:watcher:initialized', (data) =>
   {
      initialized = true;

      Util.assert.isObject(data);
      Util.assert.isArray(data.source);
      Util.assert.isArray(data.test);

      // Test separately as order of addition may be swapped.
      Util.assert.strictEqual(JSON.stringify(data.index), s_VERIFY_INIT_INDEX);
      Util.assert.strictEqual(JSON.stringify(data.manual), s_VERIFY_INIT_MANUAL);
      Util.assert.strictEqual(JSON.stringify(data.source), s_VERIFY_INIT_SOURCE);
      Util.assert.strictEqual(JSON.stringify(data.test), s_VERIFY_INIT_TEST);
   });

   eventProxy.on('tjsdoc:system:watcher:started', (data) =>
   {
      if (testInit) { Util.assert.isTrue(initialized); }

      Util.assert.isObject(data);
      Util.assert.isObject(data.index);
      Util.assert.isObject(data.index.files);
      Util.assert.isObject(data.manual);
      Util.assert.isObject(data.manual.files);
      Util.assert.isObject(data.source);
      Util.assert.isObject(data.source.files);
      Util.assert.isObject(data.test);
      Util.assert.isObject(data.test.files);

      // Filter absolute paths converting them to relative.
      for (const key in data.index.files)
      {
         const relKey = path.relative('.', key);
         data.index.files[relKey] = data.index.files[key];
         delete data.index.files[key];
      }

      for (const key in data.manual.files)
      {
         const relKey = path.relative('.', key);
         data.manual.files[relKey] = data.manual.files[key];
         delete data.manual.files[key];
      }

      for (const key in data.source.files)
      {
         const relKey = path.relative('.', key);
         data.source.files[relKey] = data.source.files[key];
         delete data.source.files[key];
      }

      for (const key in data.test.files)
      {
         const relKey = path.relative('.', key);
         data.test.files[relKey] = data.test.files[key];
         delete data.test.files[key];
      }

      // Test separately as order of addition may be swapped.
      Util.assert.strictEqual(JSON.stringify(data.index), s_VERIFY_START_INDEX);
      Util.assert.strictEqual(JSON.stringify(data.manual), s_VERIFY_START_MANUAL);
      Util.assert.strictEqual(JSON.stringify(data.source), s_VERIFY_START_SOURCE);
      Util.assert.strictEqual(JSON.stringify(data.test), s_VERIFY_START_TEST);

      if (doneCallback) { doneCallback(); }
   });
};

const s_PERFORM_CHANGES = (eventProxy, shutdownCallback) =>
{
   let unlinkCount = 2;

   const verifyInfo =
   {
      '{"action":"file:add","type":"test","path":"test/dest/test/test.js"}': false,
      '{"action":"file:add","type":"source","path":"test/dest/main/source.js"}': false,
      '{"action":"file:add","type":"test","path":"test/dest/test/test2.js"}': false,
      '{"action":"file:add","type":"source","path":"test/dest/main/source2.js"}': false,
      '{"action":"file:change","type":"source","path":"test/dest/main/source2.js"}': false,
      '{"action":"file:change","type":"test","path":"test/dest/test/test2.js"}': false,
      '{"action":"file:unlink","type":"test","path":"test/dest/test/test2.js"}': false,
      '{"action":"file:unlink","type":"source","path":"test/dest/main/source2.js"}': false
   };

   eventProxy.on('tjsdoc:system:watcher:update', (data) =>
   {
      // Remove current optional status from data event.
      delete data.options;

      const dataString = JSON.stringify(data);

      log(`s_PERFORM_CHANGES - update - data: ${dataString}`);

      verifyInfo[dataString] = true;

      if (data.action === 'file:unlink')
      {
         unlinkCount--;

         if (unlinkCount <= 0)
         {
            for (const key in verifyInfo)
            {
               if (!verifyInfo[key])
               {
                  throw new Error(`s_PERFORM_CHANGES did not complete all operations: ${JSON.stringify(verifyInfo)}`);
               }
            }

            if (shutdownCallback) { shutdownCallback(); }
         }
      }
   });

   setTimeout(() =>
   {
      fs.outputFileSync('./test/dest/main/source.js', 'new');
      fs.outputFileSync('./test/dest/test/test.js', 'new');
   }, 250);

   setTimeout(() =>
   {
      fs.outputFileSync('./test/dest/main/source2.js', 'new');
      fs.outputFileSync('./test/dest/test/test2.js', 'new');
   }, 500);

   setTimeout(() =>
   {
      fs.outputFileSync('./test/dest/main/source2.js', 'mod!');
      fs.outputFileSync('./test/dest/test/test2.js', 'mod!');
   }, 750);

   setTimeout(() =>
   {
      fs.removeSync('./test/dest/main/source2.js');
      fs.removeSync('./test/dest/test/test2.js');
   }, 1000);
};
