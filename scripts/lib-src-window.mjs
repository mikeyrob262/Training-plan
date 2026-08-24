// Windows into worker.js, for the source-text assertions the suite makes about shape rather than
// behaviour ("this call site reads the shared resolver", "there is one row builder, not three").
//
// WHY THIS EXISTS. Those assertions all need a slice of the file to search, and the suite reached
// for a character count: src.slice(indexOf('function foo('), indexOf('function foo(') + 6000). A
// character count is a guess about where a function ends. The moment that function grows past the
// guess, the window stops covering the line the assertion is looking for — and the assertion does
// not fail loudly, it goes GREEN while checking nothing, because a regex that finds no match in a
// window that no longer reaches the code is indistinguishable from one testing a smaller function.
//
// It has done exactly that twice, in one afternoon: vo2-flat-climb-test lost climbMin when
// blockPlanFor_ grew, and smurkel-persona-test lost its markdown rule when fetchSmurkelReply_ grew.
// Both were found only because an unrelated change happened to push them over the line. Nine more
// were sitting on the same fuse.
//
// So a window is bounded by the SOURCE'S OWN STRUCTURE — a matched brace, or the next section
// marker — and cannot silently shrink away from what it is asked about.

// The complete body of a top-level function, brace-matched from its declaration.
export function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fnBody: no such function: ' + name);
  let k = src.indexOf('{', i), d = 0;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('fnBody: unbalanced braces from ' + name);
}

// A commented section, from its own marker to the next one. `endMarker` defaults to the marker
// prefix, so a section runs until the next section starts rather than for N characters.
export function section(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('section: marker not found: ' + startMarker);
  const from = i + startMarker.length;
  const j = src.indexOf(endMarker || '// ---- ', from);
  return src.slice(i, j < 0 ? src.length : j);
}
