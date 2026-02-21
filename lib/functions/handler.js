import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from "uuid";
const sqsClient = new SQSClient({});

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

// Create a DynamoDB client
const client = new DynamoDBClient({});
// Create a DynamoDB document client
const docClient = DynamoDBDocumentClient.from(client);

export const newOrder = async (event) => {
  console.log(event);

  const orderId = uuidv4();
  console.log(orderId);
  // Cliente → Servidor (parse):
  let orderDetails;
  try {
    orderDetails = JSON.parse(event.body);
  } catch (error) {
    console.error("Error parsing order details", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid JSON format in order details" }),
    };
  }

  console.log(orderDetails);
  // Creamos el objeto order con la informacion del pedido sumando el id
  const order = { orderId, ...orderDetails };
  //Save order in the database
  await saveItemToDynamoDB(order);
  // Send message to the queue
  await sendMessageToSQS(order, process.env.PENDING_ORDERS_QUEUE_URL);

  // Lo devolvemos en la respuesta http que va a recibir el cliente
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: order,
    }),
  };
};

export const getOrder = async (event) => {
  console.log(event);
  const orderId = event.pathParameters.orderId;
  console.log(orderId); //Esto guarda en Cloudwatch

  try {
    const order = await getItemFromDynamo(orderId);
    console.log(order);
    return {
      statusCode: 200,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.error("Error retrieving order:", error);
    if (error.name === "ItemNotFoundException") {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Order not found" }),
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Error retrieving order" }),
      };
    }
  }

  /*Solo codigo en modo Dev */
  // Servidor → Cliente (stringify):

  // return {
  //   statusCode: 200,
  //   //JSON.stringify() es una funcion de JavaScript que convierte un objeto JavaScript a texto (string).
  //   body: JSON.stringify({
  //     orderId,
  //     pizza: "Margarita",
  //     customerId: "abc123",
  //   }),
  // };
};

export const prepOrder = async (event) => {
  console.log(event);
  // Si tuvieramos un batch mas grande hariamos una iteración
  const body = JSON.parse(event.Records[0].body);
  const orderId = body.orderId;

  await updateStatusInOrder(orderId, "COMPLETED");

  return;
};
// funcion que envia los mensajes a la cola de SQS
async function sendMessageToSQS(message, queURL) {
  // creamos un objeto de params que lo enviamos al servicio de SQS
  const params = {
    QueueUrl: queURL, // En esta cola
    MessageBody: JSON.stringify(message), // Envia este mensaje
  };
  console.log(params);
  try {
    const command = new SendMessageCommand(params);
    const data = await sqsClient.send(command);
    console.log("Message sent successfully", data.MessageId);
    return data;
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
}

export const sendOrder = async (event) => {
  console.log(event);
  if (event.Records[0].eventName === "MODIFY") {
    const eventBody = event.Records[0].dynamodb;
    console.log(eventBody);

    const orderDetails = eventBody.NewImage;
// creamos el objeto order en base a lo que viene en la nueva imagen
    const order = {
      orderId: orderDetails.orderId.S,
      pizza: orderDetails.pizza.S,
      customerId: orderDetails.customerId.S,
      order_status: orderDetails.order_status.S,
    };
    console.log(order);
    await sendMessageToSQS(order, process.env.ORDERS_TO_SEND_QUEUE_URL);
  }
  // const order = {
  //   orderId: event.orderId,
  //   pizza: event.pizza,
  //   customerId: event.pizza,
  // };
  //envia el order y la cola de esa URL

  return;
};
// Este metodo va a guardar usando la AWS SDK
async function saveItemToDynamoDB(item) {
  const params = {
    TableName: process.env.ORDER_TABLE_NAME,
    Item: item,
  };
  console.log(params);

  try {
    const command = new PutCommand(params);
    const response = await docClient.send(command);
    console.log("Item saved successfully:", response);
    return response;
  } catch (error) {
    console.error("Error saving item:", error);
    throw error;
  }
}

async function getItemFromDynamo(orderId) {
  const params = {
    TableName: process.env.ORDER_TABLE_NAME,
    Key: { orderId },
  };
  console.log(params);

  try {
    const command = new GetCommand(params);
    const response = await docClient.send(command);
    if (response.Item) {
      console.log("Item retrieved successfully:", response.Item);
      return response.Item;
    } else {
      console.log("Item not found");
      let notFoundError = new Error("Item not found");
      notFoundError.name = "ItemNotFoundException";
      throw notFoundError;
    }
  } catch (error) {
    console.error("Error retrieving item:", error);
    throw error;
  }
}

async function updateStatusInOrder(orderId, status) {
  const params = {
    TableName: process.env.ORDER_TABLE_NAME,
    Key: { orderId },
    UpdateExpression: "SET order_status = :c",
    ExpressionAttributeValues: {
      ":c": status,
    },
    ReturnValues: "ALL_NEW",
  };

  console.log(params);

  try {
    const command = new UpdateCommand(params);
    const response = await docClient.send(command);
    console.log("Item updated successfully:", response);
    return response.Attributes;
  } catch (err) {
    console.error("Error updating item:", err);
    throw err;
  }
}
