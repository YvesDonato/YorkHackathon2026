from passlib.context import CryptContext

try:
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    print("Context created successfully")
    hashed = pwd_context.hash("testpassword")
    print(f"Hashed: {hashed}")
except Exception as e:
    print(f"Error: {e}")
