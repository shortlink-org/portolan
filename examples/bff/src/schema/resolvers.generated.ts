/* This file was automatically generated. DO NOT UPDATE MANUALLY. */
    import type   { Resolvers } from './types.generated.js';
    import    { basket as Query_basket } from './basket/resolvers/Query/basket.js';
import    { order as Query_order } from './order/resolvers/Query/order.js';
import    { shipment as Query_shipment } from './delivery/resolvers/Query/shipment.js';
import    { viewer as Query_viewer } from './viewer/resolvers/Query/viewer.js';
import    { addItem as Mutation_addItem } from './basket/resolvers/Mutation/addItem.js';
import    { cancelOrder as Mutation_cancelOrder } from './order/resolvers/Mutation/cancelOrder.js';
import    { checkout as Mutation_checkout } from './basket/resolvers/Mutation/checkout.js';
import    { removeItem as Mutation_removeItem } from './basket/resolvers/Mutation/removeItem.js';
import    { orderStatus as Subscription_orderStatus } from './order/resolvers/Subscription/orderStatus.js';
import    { DateTime } from './base/resolvers/DateTime.js';
    export const resolvers: Resolvers = {
      Query: { basket: Query_basket,order: Query_order,shipment: Query_shipment,viewer: Query_viewer },
      Mutation: { addItem: Mutation_addItem,cancelOrder: Mutation_cancelOrder,checkout: Mutation_checkout,removeItem: Mutation_removeItem },
      Subscription: { orderStatus: Subscription_orderStatus },
      DateTime: DateTime
    }