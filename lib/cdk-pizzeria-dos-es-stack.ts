import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import {
  Code,
  FilterCriteria,
  Function,
  Runtime,
  StartingPosition,
} from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  DynamoEventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";

export class CdkPizzeriaDosEsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // The code that defines your stack goes here

    // Creamos la cola
    const pendingOrdersQueue = new Queue(this, "PendingOrdersQueue", {});
    // Nueva cola
    const ordersToSendQueue = new Queue(this, "OrdersToSendQueue", {});

    // DynamoDB tables
    const ordersTable = new Table(this, "OrdersTable", {
      partitionKey: { name: "orderId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Creamos una nueva funcion de Lambda que se llama newOrderFunction
    const newOrderFunction = new Function(this, "NewOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.newOrder", // el handler es un archivo de js que tiene un metodo que se llama newOrder
      code: Code.fromAsset("lib/functions"), //va estar ubicado dentro de la carpeta lib en otra carpeta que se llamafunctions
      // segundo paso despues de darle permiso a la función
      environment: {
        PENDING_ORDERS_QUEUE_URL: pendingOrdersQueue.queueUrl, //Pasamos la variable de amb de la url de la cola para poder enviar el mensaje
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });
    //Primero le damos permiso a la funcion newOrdeFunction para que pueda enviar mensajes a las cola pending..
    pendingOrdersQueue.grantSendMessages(newOrderFunction);
    ordersTable.grantWriteData(newOrderFunction); // Le damos permiso a la funcion newOrderFunction para que pueda escribir en la tabla de DynamoDB

    const getOrderFunction = new Function(this, "GetOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.getOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });
    // Le damos permiso de lectura a la funcion de getOrderFunction para poder obtener los datos del pedido
    ordersTable.grantReadData(getOrderFunction);

    // funcion Lambda que se dispara cuando hay eventos en la cola
    const prepOrderFunction = new Function(this, "PrepOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.prepOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDER_TABLE_NAME: ordersTable.tableName,
      },
    });
    // A la funcion de prepOrder le agregamos un eventSource q cuando hay un event de SQS en pendingOrdersQueue dispare la funcion de Lambda
    prepOrderFunction.addEventSource(
      new SqsEventSource(pendingOrdersQueue, {
        batchSize: 1, //Cuando hay 1 elemento se ejecuta la funcion de Lambda
      }),
    );
    ordersTable.grantWriteData(prepOrderFunction); // Le damos permiso a la funcion prepOrderFunction para que pueda escribir,hacer un update en la tabla de DynamoDB

    // nueva funcion que pone mensajes en la cola
    const sendOrderFunction = new Function(this, "SendOrderFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler.sendOrder",
      code: Code.fromAsset("lib/functions"),
      environment: {
        ORDERS_TO_SEND_QUEUE_URL: ordersToSendQueue.queueUrl,
      },
    });

    // A la funcion de sendOrder le agregamos un eventSource q cuando hay un event de DynamoDB en ordersTable dispare la funcion de Lambda
    sendOrderFunction.addEventSource(
      new DynamoEventSource(ordersTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 1,
        filters: [
          FilterCriteria.filter({
            eventName: ["MODIFY"],
          }),
        ],
      }),
    );

    ordersToSendQueue.grantSendMessages(sendOrderFunction);
    ordersTable.grantStreamRead(sendOrderFunction);

    // Creamos nuestra API Gateway
    const api = new apigateway.RestApi(this, "PizzeriaApi", {
      restApiName: "Pizzeria CDK Service",
    });

    // creamos un recurso de ordenes para hacer un post y un get
    const orderResource = api.root.addResource("order");
    // Luego asignamos este recurso a la funcion de lambda que creamos newOrderFunction
    orderResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(newOrderFunction),
    );
    // Asigamos este recurso a la funcion de lambda para obtener una orden getOrderFunction
    orderResource
      .addResource("{orderId}")
      .addMethod("GET", new apigateway.LambdaIntegration(getOrderFunction));
  }
}
// Estamos trabajando con constructores de nivel 2, son abstracciones de recursos de Cloudformation con mucho valores por defecto.No tenemos que estar definiendo un monton de cosas para poder trabajar con una funcion o con una api
