import pandas as pd
import sys

try:
    df = pd.read_excel('ZICOM-ATM-G1_32 Zone SIA code.xlsx')
    print("Columns:", df.columns.tolist())
    # Dump entire contents as a string just to grep it later or read it in python
    text = df.to_string()
    with open('excel_dump_temp.txt', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Saved to excel_dump_temp.txt")
except Exception as e:
    print(f"Error: {e}")
