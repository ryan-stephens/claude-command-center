// A made-up record lookup answer page for the tests (PLAN §132, §134), shaped like the real one as
// described from the work laptop: three forms that each repeat the record's hidden values (a role
// assignment, a move, and the update form around table#FieldResults), the hidden Fields[<id>].*
// inputs after each row's closing tag, update cells (a text box or a select, a ShouldUpdate checkbox
// and its hidden "false" twin), a read-only row with salmon update cells and no inputs, a row that
// doesn't exist (all salmon, Exists False, no ReadOnly). Nothing here is a real host, id or value.

export const RECORD = '{00000000-0000-4000-8000-000000000001}';

const hiddenRecord = `<input type="hidden" name="RecordGuid" value="${RECORD}" />
<input type="hidden" name="RecordNumber" value="SAMPLE-0001" />
<input type="hidden" name="RecordFolder" value="Sample Folder" />`;

const roles = `<input type="hidden" name="AssignedRoles[Sample Role].Id" value="7" />
<input type="hidden" name="AssignedRoles[Sample Role].Name" value="Sample Person" />`;

/** One row: its cells, then its hidden inputs after </tr>. */
function row(id: string, value: string, o: { readOnly?: boolean; missing?: boolean; options?: string[]; advanced?: boolean }): string {
  const enc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  if (o.missing) {
    return `<tr style="background-color: salmon"><td>${id}</td><td>(Field does not exist)</td><td></td><td></td></tr>
<input type="hidden" name="Fields[${id}].Value" value="" />
<input type="hidden" name="Fields[${id}].Exists" value="False" />`;
  }
  const update = o.readOnly
    ? '<td style="background-color: salmon"></td><td style="background-color: salmon"></td>'
    : `<td>${o.options
      ? `<select name="FieldsToUpdate[${id}].Value" disabled>${o.options.map((x) => `<option value="${enc(x)}">${enc(x)}</option>`).join('')}</select>`
      : `<input type="text" name="FieldsToUpdate[${id}].Value" value="" disabled />`}</td>
<td><input type="checkbox" name="FieldsToUpdate[${id}].ShouldUpdate" value="true" /><input type="hidden" name="FieldsToUpdate[${id}].ShouldUpdate" value="false" /></td>`;
  const adv = o.advanced === false ? '' : `
<input type="hidden" name="Fields[${id}].Exists" value="True" />
<input type="hidden" name="Fields[${id}].ReadOnly" value="${o.readOnly ? 'True' : 'False'}" />${(o.options ?? []).map((x, i) => `
<input type="hidden" name="Fields[${id}].Options[${i}]" value="${enc(x)}" />`).join('')}`;
  return `<tr><td>${id}</td><td>${enc(value)}</td>${update}</tr>
<input type="hidden" name="Fields[${id}].Value" value="${enc(value)}" />${adv}`;
}

export const FIELDS_TO_FETCH = '1000\r\nCX.SAMPLE.ONE\r\nGroup.Name.Role Name\r\n2000\r\nCX.MADE.UP';

/** The answer page for an Advanced fetch of five ids: two editable (a text and a select), one with a space, one read-only, one missing. */
export function lookupPage(o: { success?: string; info?: string; advanced?: boolean; env?: string } = {}): string {
  const env = o.env ?? 'Dev';
  const adv = o.advanced !== false;
  return `<!DOCTYPE html><html><body>
<form action="/App/Home/FetchFields" method="post"><select name="Environment"><option>Dev</option><option>Uat</option><option>Prod</option></select><input name="RecordGuid" /><textarea name="FieldsToFetch"></textarea><button>Fetch</button></form>
${o.success ? `<p id="SuccessMessage">${o.success}</p>` : ''}${o.info ? `<div id="InfoMessage">${o.info}</div>` : ''}
<form action="/App/Home/AssignRole" method="post">
<input type="hidden" name="Environment" value="${env}" />${hiddenRecord}${roles}
<select name="RoleToAssign"><option>Sample Role</option></select><button>Assign</button>
</form>
<form action="/App/Home/MoveRecord" method="post">
<input type="hidden" name="Environment" value="${env}" />${hiddenRecord}
<select name="TargetFolder"><option>Other Folder</option></select><button>Move</button>
</form>
<form action="/App/Home/UpdateFields" method="post">
<p>Leave the update value empty to clear a field.</p>
<table class="grid" id="FieldResults">
<tr><th>Field ID</th><th>Field Value</th><th>Update Field Value</th><th>Update Field?</th></tr>
${row('1000', '1,250.00', { advanced: adv })}
${row('CX.SAMPLE.ONE', 'Yes', { options: adv ? ['', 'Yes', 'No'] : undefined, advanced: adv })}
${row('Group.Name.Role Name', 'Tom & Jerry', { advanced: adv })}
${row('2000', 'Locked', { readOnly: adv, advanced: adv })}
${adv ? row('CX.MADE.UP', '', { missing: true }) : ''}
</table>
${hiddenRecord}
<input type="hidden" name="Environment" value="${env}" />
<input type="hidden" name="FieldsToFetch" value="${FIELDS_TO_FETCH.replace(/\r\n/g, '&#xD;&#xA;')}" />
${roles}
<button type="submit">Update</button>
</form>
</body></html>`;
}
