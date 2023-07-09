import inquirer from "inquirer";
import bcrypt from "bcrypt"
import pool from "../db.js";

async function register() {
  console.log('=== New User Registration ===');

  const questions = [
    {
      type: 'input',
      name: 'username',
      message: 'username:'
    },
    {
      type: 'password',
      name: 'password',
      message: 'password:'
    }
  ];
  
  const answers = await inquirer.prompt(questions)
  const hashedPassword = await bcrypt.hash(answers.password, 10)

  const [users] = await pool.execute('SELECT id FROM users WHERE username = ?', [answers.username])
  if (users.length > 0) {
    console.log('Registration Failed: username already exists');
    await pool.end()
    return
  }

  await pool.execute('INSERT INTO users(username, password, name, role) VALUES(?, ?, ?, ?)', [answers.username, hashedPassword, answers.username, 'entry-exit'])

  console.log('Registration Successful');
  await pool.end()
}

register()
