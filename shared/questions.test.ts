import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerText, answersComplete, questionKeys, readAnswers, readQuestions, type AskQuestion } from './questions.ts';

const color: AskQuestion = { question: 'Which color?', header: 'Color', options: [{ label: 'Red' }, { label: 'Green', description: 'Like grass' }, { label: 'Blue' }] };
const toppings: AskQuestion = { question: 'Which toppings?', header: 'Toppings', multiSelect: true, options: [{ label: 'Cheese' }, { label: 'Olives' }, { label: 'Onion' }] };

test('the form’s keys: a digit picks a single choice, digits toggle a multi choice then Tab, Enter submits (as 2.1.287 takes them)', () => {
  // The sequence that landed Green and Cheese, Onion against the real thing (§91).
  assert.deepEqual(questionKeys([color, toppings], [{ picks: [1] }, { picks: [0, 2] }]), ['2', '1', '3', 'Tab', 'Enter']);
  // One single-choice question: its digit moves to the Submit tab on its own.
  assert.deepEqual(questionKeys([color], [{ picks: [2] }]), ['3', 'Enter']);
  // Type something: the digit after the options, the text, Enter; in a multi choice it comes after the toggles.
  assert.deepEqual(questionKeys([color], [{ picks: [], other: 'Purple' }]), ['4', 'type:Purple', 'Enter', 'Enter']);
  // A multi choice never types: its "Type something" box loses the text (2.1.287), so readAnswers drops it and the keys only toggle.
  assert.deepEqual(questionKeys([toppings], [{ picks: [1] }]), ['2', 'Tab', 'Enter']);
  // A question left without an answer is passed over with Tab.
  assert.deepEqual(questionKeys([color, toppings], [{ picks: [] }, { picks: [0] }]), ['Tab', '1', 'Tab', 'Enter']);
});

test('the tool’s input is read as questions, bounded, and answers are checked against them', () => {
  const qs = readQuestions([
    { question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: 'warm' }, { label: 'Green' }], multiSelect: false },
    { question: 'Which toppings?', header: '', options: [{ label: 'Cheese' }, { label: '' }, { label: 'Onion' }], multiSelect: true },
    { question: '', options: [] },
  ])!;
  assert.deepEqual(qs.map((q) => [q.header, q.options.map((o) => o.label), q.multiSelect ?? false]), [['Color', ['Red', 'Green'], false], ['Q2', ['Cheese', 'Onion'], true]]);
  assert.equal(qs[0].options[0].description, 'warm');
  assert.equal(readQuestions('nope'), undefined);
  assert.equal(readQuestions([]), undefined);
  // Answers: out-of-range picks dropped, a single choice keeps one, text on one line and trimmed.
  const as = readAnswers([{ picks: [1, 7, 0] }, { picks: [1, 1, 0], other: 'dropped: a multi choice' }], qs);
  assert.deepEqual(as, [{ picks: [0] }, { picks: [0, 1] }]);
  assert.deepEqual(readAnswers([{ picks: [], other: '  Purple\n please  ' }], qs), [{ picks: [], other: 'Purple please' }, { picks: [] }]);
  assert.equal(answersComplete(qs, as), true);
  assert.equal(answersComplete(qs, [{ picks: [0] }, { picks: [] }]), false);
  assert.equal(answersComplete(qs, [{ picks: [] , other: 'x' }, { picks: [1] }]), true);
});

test('an answer in words is the picked labels, then what was typed', () => {
  assert.equal(answerText(toppings, { picks: [0, 2], other: 'Pickles' }), 'Cheese, Onion, Pickles');
  assert.equal(answerText(color, { picks: [], other: 'Purple' }), 'Purple');
  assert.equal(answerText(color, undefined), '');
});
