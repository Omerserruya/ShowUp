from flask import Flask, request, jsonify
import logging

app = Flask(__name__)

@app.route('/webhook', methods=['GET', 'POST'])
def webhook():
    if request.method == 'GET':
        logging.info(f"GET Request")
        return "Webhook is ready", 200

    elif request.method == 'POST':
        data = request.get_json()
        logging.info(f"POST Request: {data}")
        print(f"Received data: {data}")
        return jsonify({"status": "success"}), 200

if __name__ == '__main__':
    logging.basicConfig(
    level=logging.INFO,
    filename="app.log",
    filemode="a", 
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )  
    app.run(host="0.0.0.0",port=3000)
