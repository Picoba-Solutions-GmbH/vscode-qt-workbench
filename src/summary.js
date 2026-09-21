'use strict';

/**
 * What the user sees of an update to references: the optional confirmation before
 * it is applied, and the notification naming the files it updated -- for a move or
 * rename, and for a new file added to the project.
 */

const vscode = require('vscode');
const path = require('path');
const { log } = require('./log');

/** "a.txt, b.txt +3 more" for a list of {uri}. */
function fileNames(list) {
  const names = list
    .slice(0, 4)
    .map((t) => path.basename(t.uri.fsPath))
    .join(', ');
  return names + (list.length > 4 ? ' +' + (list.length - 4) + ' more' : '');
}

function notify(message) {
  vscode.window.showInformationMessage(message, 'Show Log').then((pick) => {
    if (pick === 'Show Log') log.show(true);
  });
}

/** Ask first when qtWorkbench.confirm is "always". True to go ahead. */
async function confirmUpdate(result) {
  if (vscode.workspace.getConfiguration('qtWorkbench').get('confirm', 'never') !== 'always') return true;
  const answer = await vscode.window.showInformationMessage(
    'Update references in ' + result.touched.length + ' file(s)?',
    { modal: true },
    'Update',
    'Skip'
  );
  return answer === 'Update';
}

/** The notification naming the updated files, unless qtWorkbench.showSummary is off. */
function showSummary(result) {
  if (!vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) return;
  const warnings = result.ctx.warnings.length;
  if (result.touched.length === 0) {
    // a delete that needed no file list updated, but left references behind
    if (warnings > 0) notify('Qt Workbench: ' + warnings + ' warning(s)');
    return;
  }
  notify('Qt Workbench: updated ' + fileNames(result.touched) + (warnings ? ' (' + warnings + ' warning(s))' : ''));
}

/** Ask first when qtWorkbench.confirm is "always": add the new file `name` to `touched`? */
async function confirmAdding(name, touched) {
  if (vscode.workspace.getConfiguration('qtWorkbench').get('confirm', 'never') !== 'always') return true;
  const answer = await vscode.window.showInformationMessage(
    'Add ' + name + ' to ' + fileNames(touched) + '?',
    { modal: true },
    'Add',
    'Skip'
  );
  return answer === 'Add';
}

/** The notification naming where a new file was added, unless qtWorkbench.showSummary is off. */
function showCreated(name, added) {
  if (!vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) return;
  let message = 'Qt Workbench: created ' + name;
  if (added.touched.length > 0) message += ', added to ' + fileNames(added.touched);
  else if (added.notes.length > 0) message += ', picked up by file(GLOB) in ' + fileNames(added.notes);
  else message += '; not added to any build file';
  notify(message + (added.warnings.length ? ' (' + added.warnings.length + ' warning(s))' : ''));
}

module.exports = { confirmUpdate, showSummary, confirmAdding, showCreated };
