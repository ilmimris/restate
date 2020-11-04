import React from "react";

export const Todo = React.memo(({ todo, index, complete, remove }) => {

  const statusStyle = { textDecoration: todo.isCompleted ? "line-through" : "" }

  return (
    <>
      <div
        key={index}
        className="todo"
        style={statusStyle}
      >
        {todo.text}

        <div>
          <button onClick={() => complete(index)}>Done</button>
          <button onClick={() => remove(index)}>x</button>
        </div>
      </div>
    </>
  );
})