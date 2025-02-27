# app.py
from flask import Flask, jsonify,request
import time

app = Flask(__name__)
start_time = time.time()

@app.route('/health', methods=['GET'])
def health():
    uptime = time.time() - start_time
    return jsonify({
        "status": "ok",
        "uptime": f"{uptime} seconds",
        "version": "1.0.0"
    })

@app.route('/send-message', methods=['POST'])
def submit_json():
    ###########################
    # Should be the main function that get json by the target, event 
    # and bring anything is needed to send to
    ###########################
    # Parse JSON data
    data = request.get_json()
    phone_number = data.get('phone-number')
    event_id = data.get('event-id')
    
    return None

if __name__ == '__main__':
    app.run(debug=True,port=3400)
