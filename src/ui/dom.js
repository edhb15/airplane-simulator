// Tiny DOM construction helpers used by the menu and HUD code.

// el('div.card.selected', { onclick, style: {...}, dataset: {...} }, children...)
export function el(spec, props = null, ...children) {
  const [tag, ...classes] = spec.split('.');
  let node;
  const hashIdx = tag.indexOf('#');
  if (hashIdx >= 0) {
    node = document.createElement(tag.slice(0, hashIdx) || 'div');
    node.id = tag.slice(hashIdx + 1);
  } else node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'class') node.className += (node.className ? ' ' : '') + v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Labelled form row
export function row(label, control, hint = null) {
  return el('label.form-row', null, el('span.form-label', null, label, hint ? el('small', null, hint) : null), control);
}

export function select(options, value, onChange) {
  const s = el('select');
  for (const o of options) {
    const opt = typeof o === 'object' ? o : { value: o, label: o };
    const e = el('option', { value: opt.value }, opt.label);
    if (opt.disabled) e.disabled = true;
    if (String(opt.value) === String(value)) e.selected = true;
    s.appendChild(e);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function slider(min, max, step, value, onInput, fmt = (v) => v) {
  const out = el('output', null, fmt(value));
  const input = el('input', { type: 'range', min, max, step });
  input.value = value;
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    onInput(Number(input.value));
  });
  return el('div.slider', null, input, out);
}

export function toggle(value, onChange, labels = ['Off', 'On']) {
  const b = el('button.toggle', { type: 'button' });
  const render = () => {
    b.classList.toggle('on', !!value);
    b.textContent = value ? labels[1] : labels[0];
  };
  b.addEventListener('click', () => {
    value = !value;
    render();
    onChange(value);
  });
  render();
  return b;
}

// Segmented button group
export function segmented(options, value, onChange) {
  const g = el('div.segmented');
  const btns = options.map((o) => {
    const opt = typeof o === 'object' ? o : { value: o, label: o };
    const b = el('button', { type: 'button', title: opt.title || '' }, opt.label);
    b.addEventListener('click', () => {
      for (const x of btns) x.classList.remove('active');
      b.classList.add('active');
      onChange(opt.value);
    });
    if (opt.value === value) b.classList.add('active');
    g.appendChild(b);
    return b;
  });
  return g;
}

export function button(label, onClick, cls = '') {
  return el(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', onclick: onClick }, label);
}

export function stars(n, max = 3) {
  return el('span.stars', null, '★'.repeat(n), el('span.dim', null, '★'.repeat(Math.max(0, max - n))));
}

export function keyCap(code) {
  const map = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Space: 'Space', Escape: 'Esc', Backquote: '`', BracketLeft: '[', BracketRight: ']', Slash: '/', Period: '.',
    Comma: ',', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", Backslash: '\\', Enter: 'Enter', Tab: 'Tab', PageUp: 'PgUp', PageDown: 'PgDn',
    NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
