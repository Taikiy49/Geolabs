import React from 'react';

const SelectProgram = ({ programs, onSelectProgram, onBack }) => {
  return (
    <>
      <h2>Select a Program</h2>
      <ul>
        {programs.map((program) => (
          <li key={program}>
            <button onClick={() => onSelectProgram(program)}>{program}</button>
          </li>
        ))}
      </ul>
      <button onClick={onBack}>Back</button>
    </>
  );
};

export default SelectProgram;
