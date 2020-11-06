import React from "react";
import { AppInterfaces } from './App.Data';

import "./TodoList.css";

import { Todo } from "./Todo";
import { TodoForm } from "./TodoForm";

const TodoList = React.memo(({ todos, addTodo, completeTodo, removeTodo }) => {

  return (
    <>
      <div className="todo-container">
        <div className="todo-list">
          {todos.map((todo, index) => (
            <Todo
              index={index}
              todo={todo}
              completeTodo={completeTodo}
              removeTodo={removeTodo}
            />
          ))}
          <TodoForm addTodo={addTodo}/>
        </div>
      </div>
    </>
  );
})

export default AppInterfaces.todoInfo(TodoList);
