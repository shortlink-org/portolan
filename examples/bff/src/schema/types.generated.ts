import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { GraphQLContext } from '../infrastructure/transport/graphql/context.ts';
export type Maybe<T> = T | null | undefined;
export type InputMaybe<T> = T | null | undefined;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type EnumResolverSignature<T, AllowedValues = any> = { [key in keyof T]?: AllowedValues };
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string | number; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** An instant, ISO 8601 with an offset. */
  DateTime: { input: unknown; output: unknown; }
};

export type AddItemInput = {
  basketId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
  sku: Scalars['String']['input'];
  /** The price the customer is looking at. Captured as sent, never recomputed. */
  unitPrice: MoneyInput;
};

export type Basket = {
  __typename?: 'Basket';
  id: Scalars['ID']['output'];
  lines: Array<Line>;
  status: BasketStatus;
  /** Absent while the basket is empty: nothing has been added to add up. */
  subtotal?: Maybe<Money>;
};

export type BasketStatus =
  | 'ABANDONED'
  | 'CHECKED_OUT'
  | 'MERGED'
  | 'OPEN';

export type CancelOrderInput = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};

/** What a checkout leaves behind: a frozen basket and the price it was frozen at. */
export type Checkout = {
  __typename?: 'Checkout';
  basketId: Scalars['ID']['output'];
  quoteId: Scalars['String']['output'];
  total: Money;
};

export type CheckoutInput = {
  basketId: Scalars['ID']['input'];
};

export type Line = {
  __typename?: 'Line';
  quantity: Scalars['Int']['output'];
  sku: Scalars['String']['output'];
  unitPrice: Money;
};

/**
 * An amount in the smallest unit of its currency: 1999 EUR is 19.99.
 *
 * Every service in the estate has its own spelling of this - `amountMinor` over
 * HTTP, `amount_minor` over gRPC - and the storefront has one. Which one a peer
 * uses is the adapter's business, and stops at the adapter.
 */
export type Money = {
  __typename?: 'Money';
  amountMinor: Scalars['Int']['output'];
  /** ISO 4217, upper case. */
  currency: Scalars['String']['output'];
};

export type MoneyInput = {
  amountMinor: Scalars['Int']['input'];
  currency: Scalars['String']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Add a line, or increase one already there. */
  addItem: Basket;
  /** Cancel an order that has not been dispatched. Cancelling twice is not an error. */
  cancelOrder: Order;
  /**
   * Freeze the basket and hand it on.
   *
   * No order exists when this answers. The cart publishes that the basket was
   * checked out, and the order service places one when it hears; ask for
   * `order` a moment later, or listen to `orderStatus`.
   */
  checkout: Checkout;
  /** Remove a line outright. */
  removeItem: Basket;
};


export type MutationaddItemArgs = {
  input: AddItemInput;
};


export type MutationcancelOrderArgs = {
  input: CancelOrderInput;
};


export type MutationcheckoutArgs = {
  input: CheckoutInput;
};


export type MutationremoveItemArgs = {
  input: RemoveItemInput;
};

export type Order = {
  __typename?: 'Order';
  id: Scalars['ID']['output'];
  lines: Array<Line>;
  placedAt: Scalars['DateTime']['output'];
  state: OrderState;
  /** What the customer agreed to at checkout, and not a penny recomputed since. */
  total: Money;
};

/** One move of one order, as it happened. */
export type OrderMoved = {
  __typename?: 'OrderMoved';
  at: Scalars['DateTime']['output'];
  orderId: Scalars['ID']['output'];
  state: OrderState;
};

export type OrderState =
  | 'CANCELLED'
  | 'CONFIRMED'
  | 'PLACED';

export type Query = {
  __typename?: 'Query';
  /** The basket as it stands, or null when there is no such basket to show. */
  basket?: Maybe<Basket>;
  /** The order, or null when the storefront has never been told of one. */
  order?: Maybe<Order>;
  /** Where the parcel is, or null when nothing has been handed to a carrier yet. */
  shipment?: Maybe<Shipment>;
  /**
   * Who the request belongs to, or null when it belongs to nobody.
   *
   * There is no `login` here. Sessions are minted by auth and nowhere else, and
   * a BFF that took a password would be a second place credentials go.
   */
  viewer?: Maybe<Viewer>;
};


export type QuerybasketArgs = {
  id: Scalars['ID']['input'];
};


export type QueryorderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryshipmentArgs = {
  id: Scalars['ID']['input'];
};

export type RemoveItemInput = {
  basketId: Scalars['ID']['input'];
  sku: Scalars['String']['input'];
};

export type Shipment = {
  __typename?: 'Shipment';
  id: Scalars['ID']['output'];
  orderId: Scalars['ID']['output'];
  parcels: Scalars['Int']['output'];
  /**
   * What delivery calls the state of this parcel.
   *
   * A string rather than an enum on purpose: delivery answers with one, and a
   * set of values invented here would be a promise this service cannot keep.
   */
  state: Scalars['String']['output'];
  /** The code a customer pastes into a carrier's site. */
  trackingCode?: Maybe<Scalars['String']['output']>;
};

export type Subscription = {
  __typename?: 'Subscription';
  /**
   * Every move an order makes, until it stops moving.
   *
   * The storefront does not poll the order service for this: the moves are on
   * the bus already, and this is the same events, forwarded to whoever is
   * watching this order.
   */
  orderStatus: OrderMoved;
};


export type SubscriptionorderStatusArgs = {
  id: Scalars['ID']['input'];
};

/** A signed-in customer, as much of one as the storefront needs to know. */
export type Viewer = {
  __typename?: 'Viewer';
  /** When the session stops being live. */
  expiresAt: Scalars['DateTime']['output'];
  userId: Scalars['ID']['output'];
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AddItemInput: AddItemInput;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Basket: ResolverTypeWrapper<Omit<Basket, 'status'> & { status: ResolversTypes['BasketStatus'] }>;
  BasketStatus: ResolverTypeWrapper<'OPEN' | 'CHECKED_OUT' | 'ABANDONED' | 'MERGED'>;
  CancelOrderInput: CancelOrderInput;
  Checkout: ResolverTypeWrapper<Checkout>;
  CheckoutInput: CheckoutInput;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Line: ResolverTypeWrapper<Line>;
  Money: ResolverTypeWrapper<Money>;
  MoneyInput: MoneyInput;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Order: ResolverTypeWrapper<Omit<Order, 'state'> & { state: ResolversTypes['OrderState'] }>;
  OrderMoved: ResolverTypeWrapper<Omit<OrderMoved, 'state'> & { state: ResolversTypes['OrderState'] }>;
  OrderState: ResolverTypeWrapper<'PLACED' | 'CONFIRMED' | 'CANCELLED'>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RemoveItemInput: RemoveItemInput;
  Shipment: ResolverTypeWrapper<Shipment>;
  Subscription: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Viewer: ResolverTypeWrapper<Viewer>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AddItemInput: AddItemInput;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  String: Scalars['String']['output'];
  Basket: Basket;
  CancelOrderInput: CancelOrderInput;
  Checkout: Checkout;
  CheckoutInput: CheckoutInput;
  DateTime: Scalars['DateTime']['output'];
  Line: Line;
  Money: Money;
  MoneyInput: MoneyInput;
  Mutation: Record<PropertyKey, never>;
  Order: Order;
  OrderMoved: OrderMoved;
  Query: Record<PropertyKey, never>;
  RemoveItemInput: RemoveItemInput;
  Shipment: Shipment;
  Subscription: Record<PropertyKey, never>;
  Viewer: Viewer;
  Boolean: Scalars['Boolean']['output'];
};

export type BasketResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Basket'] = ResolversParentTypes['Basket']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['Line']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['BasketStatus'], ParentType, ContextType>;
  subtotal?: Resolver<Maybe<ResolversTypes['Money']>, ParentType, ContextType>;
};

export type BasketStatusResolvers = EnumResolverSignature<{ ABANDONED?: any, CHECKED_OUT?: any, MERGED?: any, OPEN?: any }, ResolversTypes['BasketStatus']>;

export type CheckoutResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Checkout'] = ResolversParentTypes['Checkout']> = {
  basketId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  quoteId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type LineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Line'] = ResolversParentTypes['Line']> = {
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  unitPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export type MoneyResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Money'] = ResolversParentTypes['Money']> = {
  amountMinor?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  currency?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  addItem?: Resolver<ResolversTypes['Basket'], ParentType, ContextType, RequireFields<MutationaddItemArgs, 'input'>>;
  cancelOrder?: Resolver<ResolversTypes['Order'], ParentType, ContextType, RequireFields<MutationcancelOrderArgs, 'input'>>;
  checkout?: Resolver<ResolversTypes['Checkout'], ParentType, ContextType, RequireFields<MutationcheckoutArgs, 'input'>>;
  removeItem?: Resolver<ResolversTypes['Basket'], ParentType, ContextType, RequireFields<MutationremoveItemArgs, 'input'>>;
};

export type OrderResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Order'] = ResolversParentTypes['Order']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['Line']>, ParentType, ContextType>;
  placedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['OrderState'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export type OrderMovedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderMoved'] = ResolversParentTypes['OrderMoved']> = {
  at?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  orderId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['OrderState'], ParentType, ContextType>;
};

export type OrderStateResolvers = EnumResolverSignature<{ CANCELLED?: any, CONFIRMED?: any, PLACED?: any }, ResolversTypes['OrderState']>;

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  basket?: Resolver<Maybe<ResolversTypes['Basket']>, ParentType, ContextType, RequireFields<QuerybasketArgs, 'id'>>;
  order?: Resolver<Maybe<ResolversTypes['Order']>, ParentType, ContextType, RequireFields<QueryorderArgs, 'id'>>;
  shipment?: Resolver<Maybe<ResolversTypes['Shipment']>, ParentType, ContextType, RequireFields<QueryshipmentArgs, 'id'>>;
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
};

export type ShipmentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Shipment'] = ResolversParentTypes['Shipment']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  orderId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  parcels?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trackingCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type SubscriptionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription']> = {
  orderStatus?: SubscriptionResolver<ResolversTypes['OrderMoved'], "orderStatus", ParentType, ContextType, RequireFields<SubscriptionorderStatusArgs, 'id'>>;
};

export type ViewerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = {
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLContext> = {
  Basket?: BasketResolvers<ContextType>;
  BasketStatus?: BasketStatusResolvers;
  Checkout?: CheckoutResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  Line?: LineResolvers<ContextType>;
  Money?: MoneyResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Order?: OrderResolvers<ContextType>;
  OrderMoved?: OrderMovedResolvers<ContextType>;
  OrderState?: OrderStateResolvers;
  Query?: QueryResolvers<ContextType>;
  Shipment?: ShipmentResolvers<ContextType>;
  Subscription?: SubscriptionResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
};

