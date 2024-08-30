import os

def open_file_or_directory(file_path, original_file_name):
    if os.path.isfile(file_path):
        print(f"Opening file: {file_path}")
        # Open the file using the default associated application on Windows
        os.startfile(file_path)  # This will open the file on your laptop
    elif os.path.isdir(file_path):
        print(f"Opening directory: {file_path}")
        # Open the directory in a new file explorer window
        os.startfile(file_path)  # This will open the directory in a file explorer window
        # List the contents of the directory and find the specific file
        files_in_directory = os.listdir(file_path)
        for file_name in files_in_directory:
            if file_name == original_file_name:
                full_file_path = os.path.join(file_path, file_name)
                open_file_or_directory(full_file_path, original_file_name)  # Recursive call to open the file

def open_series_directories(network_path, original_file_name):
    try:
        # List all series directories in the specified network location
        series_dirs = os.listdir(network_path)
        
        # Extract the first four digits and next two digits from the test file name
        test_pattern = original_file_name[:7]  # "xxxx-xx"
        
        # Construct the series name
        series_prefix = original_file_name[:2]  # First two digits to identify series
        target_series = f"{series_prefix}00 Series"

        # Iterate through each series directory
        for series in series_dirs:
            # Check if the directory matches the target series
            if series == target_series:
                series_path = os.path.join(network_path, series)

                # Check if the path is indeed a directory
                if os.path.isdir(series_path):
                    print(f"\nContents of {series}:")

                    # List all files in the series directory
                    files_in_series = os.listdir(series_path)

                    # Find and open files or directories that match the pattern "xxxx-xx"
                    for file_name in files_in_series:
                        # Extract the first part up to the 7th character
                        file_pattern = file_name[:7]  # Get the pattern "xxxx-xx"
                        
                        # Check if this pattern matches the test pattern
                        if file_pattern == test_pattern:
                            full_path = os.path.join(series_path, file_name)
                            open_file_or_directory(full_path, original_file_name)
                
                # Break out of the loop after processing the first matching series
                break

    except Exception as e:
        print(f"An error occurred: {e}")

# Network path to the usershare on the VPN-connected drive
network_path = r"\\geolabs.lan\fs\UserShare"

# Call the function with the network path and the filename
file_name_to_check = "8005-00.hc1.GEE.Kahilinai Place and Aiea Heights Drive Water System Improvements.pdf"
open_series_directories(network_path, file_name_to_check)
