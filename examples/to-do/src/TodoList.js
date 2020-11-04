import React, { useState, useRef } from "react";
import { AppAction, AppInterfaces } from './App.Data';

import "./TodoList.css";

import { Todo } from "./Todo";
import { TodoForm } from "./TodoForm";

const TodoList = ({ todos }) => {
  const appAction = useRef(null);

  const complete = React.useCallback((index) => {
    appAction.current.completeTodo(index)
  })

  const remove = React.useCallback((index) => {
    appAction.current.removeTodo(index)
  })

  return (
    <>
      <AppAction ref={appAction} />
      <div className="todo-container">
        <div className="todo-list">
          {todos.map((todo, index) => (
            <Todo
              key={index}
              index={index}
              todo={todo}
              complete={complete}
              remove={remove}
            />
          ))}
          <TodoForm />
        </div>
      </div>
    </>
  );
}

export default AppInterfaces.todoInfo(TodoList);
