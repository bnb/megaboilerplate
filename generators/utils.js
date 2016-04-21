import { template, last, isEmpty, dropRight } from 'lodash';

const path = require('path');
const archiver = require('archiver');
const shortid = require('shortid');
const fs = require('fs-extra');
const Promise = require('bluebird');
const cpy = require('cpy');
const copy = Promise.promisify(fs.copy);
const readFile = Promise.promisify(fs.readFile);
const writeFile = Promise.promisify(fs.writeFile);
const appendFile = Promise.promisify(fs.appendFile);
const remove = Promise.promisify(fs.remove);
const readJson = Promise.promisify(fs.readJson);
const writeJson = Promise.promisify(fs.writeJson);
const stat = Promise.promisify(fs.stat);
const mkdirs = Promise.promisify(fs.mkdirs);

const npmDependencies = require('./npmDependencies.json');

export { cpy };
export { copy };
export { remove };
export { mkdirs };
export { readFile };
export { writeFile };
export { appendFile };
export { readJson };
export { writeJson };

/**
 * @private
 * @param subStr {string} - what to indent
 * @param options {object} - how many levels (2 spaces per level) or how many spaces to indent
 * @returns {string}
 */
function indentCode(subStr, options) {
  const defaultIndentation = 2;
  let indent;

  if (options.indentLevel) {
    indent = ' '.repeat(options.indentLevel * defaultIndentation);
  } else if (options.indentSpaces) {
    indent = ' '.repeat(options.indentSpaces);
  }
  let array = subStr.toString().split('\n').filter(Boolean);
  array.forEach((line, index) => {
    array[index] = indent + line;
  });
  return array.join('\n');
}

/**
 * Traverse files and remove placeholder comments
 * @param params
 */
export function walkAndRemoveComments(params) {
  const build = path.join(__base, 'build', params.uuid);

  return new Promise((resolve, reject) => {
    fs.walk(build)
      .on('data', (item) => {
        return stat(item.path).then((stats) => {
          if (stats.isFile()) {
            return removeCode(item.path, '//=');
          }
        });
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        resolve();
      });
  });
}

export async function exists(filepath) {
  try {
    await stat(filepath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
  }
  return true;
}

export function generateZip(req, res) {
  let archive = archiver('zip');

  archive.on('error', function(err) {
    res.status(500).send(err.message);
  });

  res.on('close', function() {
    console.log('closing...');
    console.log('Archive wrote %d bytes', archive.pointer());
    return res.status(200).send('OK').end();
  });

  res.attachment('megaboilerplate-express.zip');

  archive.pipe(res);

  let files = [
    __base + '/modules/express/app.js',
    __base + '/modules/express/package.json'
  ];

  for (let i in files) {
    archive.append(fs.createReadStream(files[i]), { name: path.basename(files[i]) });
  }

  archive.finalize();
}

/**
 * Add NPM package to package.json.
 * @param pkgName
 * @param params
 * @param isDev
 */
export async function addNpmPackage(pkgName, params, isDev) {
  const packageJson = path.join(__base, 'build', params.uuid, 'package.json');
  const packageObj = await readJson(packageJson);
  const pkgVersion = npmDependencies[pkgName];

  if (isDev) {
    packageObj.devDependencies = packageObj.devDependencies || {};
    packageObj.devDependencies[pkgName] = pkgVersion;
  } else {
    packageObj.dependencies[pkgName] = pkgVersion;
  }

  // Sort dependencies alphabetically in package.json
  packageObj.dependencies = sortJson(packageObj.dependencies);
  
  if (packageObj.devDependencies) {
    packageObj.devDependencies = sortJson(packageObj.devDependencies);
  }

  await writeJson(packageJson, packageObj, { spaces: 2 });
}

function sortJson(obj) {
  return Object.keys(obj).sort().reduce((a, b) => {
    a[b] = obj[b];
    return a;
  }, {});
}

/**
 * Add NPM script to package.json.
 */
export async function addNpmScript(name, value, params) {
  const packageJson = path.join(__base, 'build', params.uuid, 'package.json');
  const packageObj = await readJson(packageJson);
  packageObj.scripts[name] = value;
  await writeJson(packageJson, packageObj, { spaces: 2 });
}

/**
 * Cleanup build files.
 * @param params
 */
export async function cleanup(params) {
  await remove(path.join(__base, 'build', params.uuid));
}

export async function prepare(params) {
  //params.uuid = shortid.generate();
  // TODO: Remove
  params.uuid = 'testing';
  await remove(path.join(__base, 'build', params.uuid));

  await mkdirs(path.join(__base, 'build', params.uuid));
  console.info('Created', params.uuid);
  return params;
}

/**
 * @param srcFile {buffer} - where to remove
 * @param subStr {string} - what to remove
 * @returns {string}
 */
export async function removeCode(srcFile, subStr) {
  let srcData = await readFile(srcFile);
  let array = srcData.toString().split('\n');
  const emptyClass = ' class=""';
  const emptyClassName = ' className=""'; // React

  array.forEach((line, index) => {
    // Strip empty classes
    if (line.includes(emptyClass)) {
      array[index] = line.split(emptyClass).join('');
    } else if (line.includes(emptyClassName)) {
      array[index] = line.split(emptyClassName).join('');
    }
    
    if (line.includes(subStr)) {
      array[index] = null;
    }
  });
  array = array.filter((value) => {
    return value !== null;
  });
  srcData = array.join('\n');
  await writeFile(srcFile, srcData);
}

/**
 *
 * @param srcFile {buffer} - where to replace
 * @param subStr {string} - what to replace
 * @param newSrcFile {string} - replace it with this
 * @param [opts] {object} - options
 * @returns {string}
 */
export async function replaceCode(srcFile, subStr, newSrcFile, opts) {
  opts = opts || {};

  let srcData = await readFile(srcFile);
  let newSrcData = await readFile(newSrcFile);

  const array = srcData.toString().split('\n');

  if (opts.debug) {
    console.log(array);
  }

  array.forEach((line, index) => {
    const re = new RegExp(subStr + '($|\r\n|\r|\n)');
    const isMatch = re.test(line);

    // Preserve whitespace if it detects //_ token
    if (line.indexOf('//_') > - 1) {
      array[index] = '';
    }

    if (opts.debug) {
      console.log(re, isMatch, line);
    }
    
    if (isMatch) {
      if (opts.indentLevel) {
        newSrcData = indentCode(newSrcData, { indentLevel: opts.indentLevel });
      }

      if (opts.indentSpaces) {
        newSrcData = indentCode(newSrcData, { indentSpaces: opts.indentSpaces });
      }

      if (isEmpty(last(newSrcData.toString().split('\n')))) {
        newSrcData = dropRight(newSrcData.toString().split('\n')).join('\n');
      }

      if (opts.leadingBlankLine) {
        newSrcData = ['\n', newSrcData].join('');
      }

      array[index] = newSrcData;
    }
  });

  srcData = array.join('\n');

  await writeFile(srcFile, srcData);
}

/**
 * lodash _.template() function
 * @param srcFile
 * @param data
 */
export async function templateReplace(srcFile, data) {
  const src = await readFile(srcFile);
  const compiled = template(src.toString());
  const newSrc = compiled(data);
  await writeFile(srcFile, newSrc);
}

/**
 * Add env vars to .env
 * @param params
 * @param data
 */
export async function addEnv(params, data) {
  const env = path.join(__base, 'build', params.uuid, '.env');
  const vars = [];
  for (const i in data) {
    if (data.hasOwnProperty(i)) {
      vars.push([i, `'${data[i]}'`].join('='));
    }
  }
  await appendFile(env, '\n' + vars.join('\n') + '\n');
}
