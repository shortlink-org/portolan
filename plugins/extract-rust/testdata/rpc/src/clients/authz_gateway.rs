type AuthzClient = AuthzServiceClient<Channel>;

struct AuthzGateway {
    authz: AuthzClient,
}

impl AuthzGateway {
    async fn check(&self, request: Request) {
        let mut client = self.authz.clone();
        client.check_permission(request).await;
    }
}
