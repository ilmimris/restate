import React, { useState } from "react";

export const TodoForm = React.memo(({addTodo}) => {
  const [value, setValue] = useState("");

  const handleSubmit = e => {
    e.preventDefault();
    if (!value)
      return;
    addTodo(value);
    setValue("");
  };


  return (
    <>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          className="input"
          value={value}
          onChange={e => setValue(e.target.value)} />
      </form>
    </>
  );
})
