//! tonic's output for the narrowed copy under ../proto, committed as every
//! generated file here is: `buf generate --template buf.payments.gen.yaml`.
#![allow(clippy::all, unused)]

pub mod payments {
    pub mod v1 {
        include!("payments/v1/payments.v1.rs");
    }
}
