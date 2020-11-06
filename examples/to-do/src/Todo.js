import React from "react";
import { AppAction } from "./App.Data";

export const Todo = React.memo(({ todo, index, completeTodo, removeTodo }) => {
  const appAction = React.useRef(null);

  const complete = () => {
    completeTodo(index)
  }

  const remove = () => {
    removeTodo(index)
  }

  const statusStyle = { textDecoration: todo.isCompleted ? "line-through" : "" }

  return (
    <>
      <AppAction ref={appAction} />

      <div
        key={index}
        className="todo"
        style={statusStyle}
      >
        {todo.text}

        <div>
          <button onClick={complete}>Done</button>
          <button onClick={remove}>x</button>
        </div>
      </div>
    </>
  );
}, (prev, next) => {
  return prev.todo === next.todo
})
