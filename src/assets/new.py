# Program 1: Simple Addition Calculator

def add_two_numbers():
    """
    Prompts the user for two numbers and prints their sum.
    """
    try:
        # Get the first number from the user
        num1 = float(input("Enter the first number: "))
        
        # Get the second number from the user
        num2 = float(input("Enter the second number: "))
        
        # Calculate the sum
        result = num1 + num2
        
        # Print the result
        print(f"The sum of {num1} and {num2} is: {result}")
        
    except ValueError:
        print("Invalid input. Please enter valid numbers only.")

# Call the function to run the program
add_two_numbers()