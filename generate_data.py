import os
import json
import re

dir_path = r"c:\Users\GIS_11\Desktop\GIS_Projects\Gatishakti\Range_kml"
out_path = r"c:\Users\GIS_11\Desktop\GIS_Projects\projects\RFRL_Boundary_Survey_App\divisions_data.js"

data = {}

if os.path.exists(dir_path):
    for f in os.listdir(dir_path):
        if f.lower().endswith(".kml"):
            base = os.path.splitext(f)[0]
            parts = base.split('_', 1)
            if len(parts) == 2:
                div = parts[0].strip().upper()
                rng = parts[1].strip().upper()
                if div not in data:
                    data[div] = []
                if rng not in data[div]:
                    data[div].append(rng)

for div in data:
    data[div].sort()

# Also ensure main divisions exist
standard_divs = [
    "CHENNAI", "CHENGALPATTU", "COIMBATORE", "CUDDALORE", "DHARMAPURI", "DINDIGUL",
    "ERODE", "GUDALUR", "HOSUR", "KANYAKUMARI", "KARUR", "KODAIKANAL", "MADURAI",
    "NAMAKKAL", "NILGIRIS", "PERAMBALUR", "PUDUKKOTTAI", "RAMANATHAPURAM", "SALEM",
    "SIVAGANGAI", "THANJAVUR", "THENI", "THIRUVARUR", "THOOTHUKUDI", "TIRUCHIRAPPALLI",
    "TIRUNELVELI", "TIRUPPATTUR", "TIRUVALLUR", "TIRUVANNAMALAI", "VELLORE", "VILUPPURAM"
]
for sd in standard_divs:
    if sd not in data:
        data[sd] = [f"{sd} RANGE"]

with open(out_path, "w", encoding="utf-8") as fp:
    fp.write("// Tamil Nadu Forest Department - Master Divisions & Ranges Registry\n")
    fp.write("window.TN_DIVISIONS_DATA = " + json.dumps(data, indent=2) + ";\n")

print(f"Generated divisions data with {len(data)} divisions.")
