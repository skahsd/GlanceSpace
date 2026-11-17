pub mod scan;
#[cfg(feature = "desktop")]
mod shell;

#[cfg(feature = "desktop")]
mod app;
#[cfg(feature = "desktop")]
pub use app::run;
