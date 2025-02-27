import requests,json,os

# Replace with your WhatsApp Cloud API access token
ACCESS_TOKEN = os.environ['WA_API_B']

def create_whatsapp_template_message(to_number, template_name, language_code, **args):
    # התחלה של מבנה ההודעה
    message = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {
                "code": language_code
            },
            "components": [
                {
                    "type": "body",
                    "parameters": []
                }
            ]
        }
    }
    
    # הוספת כל הפרמטרים מהארגומנטים הדינמיים לתוך רשימת הפרמטרים
    for arg in args.values():
        message["template"]["components"][0]["parameters"].append({
            "type": "text",
            "text": arg
        })
    
    return message

def send_whatsapp_template_message(phone_ID,to_number, template_name, language_code, **args):
   # Replace with your WhatsApp Business Phone Number ID
    url = f"https://graph.facebook.com/v17.0/{phone_ID}/messages"

    # The headers for the POST request
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    # The message payload (text message)
    data = create_whatsapp_template_message(to_number, template_name, language_code, **args)

    # Send the request
    response = requests.post(url, headers=headers, data=json.dumps(data))

    # Print the response
    if response.status_code == 200:
        print("Message sent successfully!")
        print(response.json())  # Print the response for reference
    else:
        print(f"Failed to send message. Status code: {response.status_code}")
        print(response.text)


if __name__ == "__main__":
    args = {
    "date": "5 בנובמבר 2024",
    "time": "19:30",
    "location": "גן האירועים",
    "hosts": "עומר ושני"
    }
    send_whatsapp_template_message("488500504337884","972525401686", "wedding_simple", "he", **args)
