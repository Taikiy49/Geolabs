import os

# Define the network paths
USER_SHARE_PATH = r"\\geolabs.lan\fs\UserShare"
REPORTS_PATH = r"\\geolabs.lan\fs\Reports"  # Path where the file will always be opened

def open_file_or_directory(file_path):
    """Open a file or directory using the default associated application."""
    if os.path.isfile(file_path):
        print(f"Opening file: {file_path}")
        # Open the file using the default associated application on Windows
        os.startfile(file_path)
    elif os.path.isdir(file_path):
        print(f"Opening directory: {file_path}")
        # Open the directory in a new file explorer window
        os.startfile(file_path)

def open_series_directories(network_path, original_file_name):
    try:
        # List all series directories in the specified network location
        series_dirs = os.listdir(network_path)
        
        # Extract the first four digits and next two digits from the file name
        test_pattern = original_file_name[:7]  # "xxxx-xx"
        
        # Construct the series name from the first two digits
        series_prefix = original_file_name[:2]  # First two digits to identify series
        target_series = f"{series_prefix}00 Series"

        # Iterate through each series directory
        for series in series_dirs:
            # Check if the directory matches the target series
            if series == target_series:
                series_path = os.path.join(network_path, series)

                # Check if the path is indeed a directory
                if os.path.isdir(series_path):
                    print(f"\nOpening series directory: {series_path}")
                    
                    # List all subdirectories within the series directory
                    subdirs = [d for d in os.listdir(series_path) if os.path.isdir(os.path.join(series_path, d))]

                    # Look for a more specific directory match
                    specific_dir_found = False
                    for subdir in subdirs:
                        # Check if the subdirectory starts with the same pattern as the file
                        if subdir.startswith(test_pattern[:4]):  # Check first 4 digits
                            specific_path = os.path.join(series_path, subdir)
                            print(f"Opening specific directory: {specific_path}")
                            open_file_or_directory(specific_path)
                            specific_dir_found = True
                            break  # Stop after finding the first specific directory match

                    # If no specific subdirectory is found, open the series directory itself
                    if not specific_dir_found:
                        print(f"No specific subdirectory found; opening series directory: {series_path}")
                        open_file_or_directory(series_path)

                    # Always open the file from the REPORTS_PATH
                    report_file_path = os.path.join(REPORTS_PATH, original_file_name)
                    report_file_path = report_file_path.replace('.txt', '.pdf')  # Convert .txt to .pdf

                    if os.path.exists(report_file_path):
                        print(f"Opening file from Reports: {report_file_path}")
                        open_file_or_directory(report_file_path)
                    else:
                        print(f"Error: File '{original_file_name}' not found in {REPORTS_PATH}.")

                # Stop after processing the first matching series directory
                break

    except Exception as e:
        print(f"An error occurred: {e}")

def handle_file_request(filename):
    # Always open the specific directory from UserShare
    open_series_directories(USER_SHARE_PATH, filename)

    # Adjust the filename to have the .pdf extension
    filename = filename.replace('.txt', '.pdf')

    # Always attempt to open the specific file from the Reports path
    report_file_path = os.path.join(REPORTS_PATH, filename)
    if os.path.exists(report_file_path):
        print(f"Success: File '{filename}' found in {REPORTS_PATH}.")
        open_file_or_directory(report_file_path)
        return {'message': f"File '{filename}' found and opened successfully."}, 200
    else:
        print(f"Error: File '{filename}' not found in {REPORTS_PATH}.")
        return {'error': f"File '{filename}' not found."}, 404
