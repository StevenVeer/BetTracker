import { forwardRef } from 'react';

// Bedrag/odds-veld dat zowel "506,03" als "506.03" accepteert. Een native
// <input type="number"> negeert of verminkt de komma afhankelijk van de
// browser-locale (506,03 werd zo 50603), dus dit is een tekstveld dat de komma
// direct omzet naar een punt - de rest van de app blijft met punt-strings
// rekenen zoals voorheen.
const DecimalInput = forwardRef(function DecimalInput({ onChange, ...props }, ref) {
  function handleChange(e) {
    const normalized = e.target.value.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    if (normalized !== e.target.value) e.target.value = normalized;
    onChange?.(e);
  }
  return <input ref={ref} type="text" inputMode="decimal" autoComplete="off" {...props} onChange={handleChange} />;
});

export default DecimalInput;
