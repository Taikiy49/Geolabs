import sqlite3
import os

# Paths to your SQLite database files
data_db_path = 'data.db'
employee_db_path = 'employee.db'

def reset_database(db_path):
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all table names in the database
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    
    # Delete all data from each table
    for table_name in tables:
        cursor.execute(f"DELETE FROM {table_name[0]}")
        print(f"Deleted all records from table: {table_name[0]} in {db_path}")
    
    # Commit changes and close the connection
    conn.commit()
    conn.close()

# Reset data.db
reset_database(data_db_path)

# Reset employee.db
reset_database(employee_db_path)

# Optionally, insert sample data into data.db and employee.db
def insert_sample_data(db_path, table, data):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Insert the sample data
    cursor.execute(f"INSERT INTO {table} VALUES (?, ?)", data)
    conn.commit()
    conn.close()

# Example to insert sample data
# Insert sample data for demonstration purposes
# Adjust table names and data according to your database schema
insert_sample_data(data_db_path, 'users', ('test_email', 'test_password'))
insert_sample_data(employee_db_path, 'employees', ('sample_employee', 'sample_position'))
