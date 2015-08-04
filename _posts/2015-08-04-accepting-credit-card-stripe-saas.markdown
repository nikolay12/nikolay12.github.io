---
layout: post
title:  "Accepting a Credit Card: a SaaS application in a nutshell (Stripe, Rails4, Devise3)"
date:   2015-08-02 21:00:00
categories: Blog
---

Recently I [blogged about](http://nikolov.me.uk/blog/2015/07/24/overriding-devise-to-skip-setting-of-password.html) a light-touch workflow which allows registration without setting a password. This blog post and the [accompanying git repository](https://github.com/nikolay12/new_devise) take it from there and add credit card registration via Stripe. I was thinking of what could the absolutely minimal SaaS application and came with the conclusion that it recording the credit card details constitutes the absolutely irreducable bit - without it you can't have a SaaS application. So, this lengthy blog post is about creating such a minimal SaaS application that does nothing but allowing people to sign up and record their credit card details. 

In realistic scenarios applications would first allow free trials and than at their expiry would prompt users to submit their credit card. Many would apply some version of a freemium model where the users can keep a free account but would be regularly tempted to upgrade. This would be too complicated for the purposes of this blog post. So we would simply collect the  credit card details upfront at the registration. 

<h2>1. Pre-requisites</h2>

This tutorial assumes that people have already set up a minimal application allowing a password-less registration using Devise as described in [a previous post](http://nikolov.me.uk/blog/2015/07/24/overriding-devise-to-skip-setting-of-password.html). Another pre-requisite is a registration with [Stripe](http://www.stripe.com).

<h2>2. Adding Stripe and Papertrail</h2>

The starting point for this tutorial is [the code](https://github.com/nikolay12/my_devise) for the earlier blog post. The first change is, of course, adding Stripe to the Gemfile:

`gem "stripe", '1.21'`

Another gem that we would add is [Papertrail](https://github.com/airblade/paper_trail). It allows us to create an auditable trail for any changes to selected models. Strictly speaking, adding an auditable trail does not meet the requirement of being absolutely irreducible but it is a good practice to follow in real life so we would include it: 

`gem 'paper_trail', '~> 3.0.6'`

We also need to execute

```
rails generate paper_trail:install --with-changes
```
Stripe uses public and private keys to authenticate the user - these can be found in the user profile upon registering. Rails needs to know these keys to be able to authenticate. We add /config/initializers/stripe.rb:

```
Rails.configuration.stripe = {
    publishable_key: RailsDevise.config.STRIPE_PUBLISHABLE_KEY,
    secret_key:      RailsDevise.config.STRIPE_SECRET_KEY
}

Stripe.api_key = \
  Rails.configuration.stripe[:secret_key]
```
At the end of this step the code base shall be identical to commit [dd2e27875863d14f2e1fcfb1c76ea61824781afa](https://github.com/nikolay12/new_devise/tree/dd2e27875863d14f2e1fcfb1c76ea61824781afa).

You need, of course, to run 

`bundle install`

to install the gems.

The code above uses the [econfig gem](https://github.com/elabs/econfig) to load the environment variables and database credentials. I'm storing these in config/secrets.yml (you just need to enter your values):

```
development:
  STRIPE_PUBLISHABLE_KEY: ""
  STRIPE_SECRET_KEY: ""
  MANDRILL_USERNAME: ""
  MANDRILL_API_KEY: ""
  MANDRILL_DOMAIN: ""
  RETURN_EMAIL: ""
  DEVISE_SECRET: ""
  secret_key_base: ""
```

<h2>3. Generating models for a nutshell SaaS application</h2>

The minimal models needed for a SaaS application requires a plan and a subscription:

```
rails g model plan \
    stripe_id:string \
    name:string 
        
    rails g model subscription \
    user:references \
    plan:references \
    stripe_id:string
```

Usually, a plan has a price and an interval (e.g. monthly, weekly, etc.) associated with it. We will define this within Stripe. To keep our application DRY we will include in our database is, essentially, only pointers to the data stored in Stripe. We would need the same pointer in the user table:

```
rails g migration AddStripeCustomerIdToUser \
    stripe_customer_id:string
```

We'll tighten up the subscription model a bit by setting the foreign keys to be NOT NULL:

```
class AddChangeColumnNullSubscription < ActiveRecord::Migration
  def change
    change_column_null :subscriptions, :user_id, false
    change_column_null :subscriptions, :plan_id, false
  end
end
```

We'll also add an audit trail to the models (example below is for Plan but the change is identical for the other two models):

```
class Plan < ActiveRecord::Base
  has_paper_trail
end
```

At the end we need to run

```
rake db:migrate
```

<h2>4. Creating Stripe plans</h2>

We will create 

```
#app/services/create_plan.rb
class CreatePlan
  def self.call(options={})
    Rails.logger.info "Creating plan " + options[:name].to_s + ".."
    plan = Plan.new(stripe_id: options[:stripe_id], name: options[:name])
    Rails.logger.info "Plan " + options[:name].to_s + " created!"

    if !plan.valid?
      Rails.logger.info "Plan not valid.."
      Rails.logger.info plan.errors.full_messages
      return plan
    end

    begin
      splan = Stripe::Plan.create(
          id: options[:stripe_id],
          amount: options[:amount],
          currency: options[:currency],
          interval: options[:interval],
          trial_period_days: options[:trial_period_days],
          name: options[:name]
      )
        Rails.logger.info "stripe insert went well.."
        Rails.logger.info splan.created
    rescue Stripe::StripeError => e
      Rails.logger.info "stripe insert did not go well.."
      if e.message != "Plan already exists."
        Rails.logger.error e.message
        plan.errors[:base] << e.message
        return plan
      else
        Rails.logger.info "Plan already exists."
        Rails.logger.error e.message
      end
    end

    plan.save

    return plan
  end
end
```
and

```
#db/seeds.rb
CreatePlan.call(stripe_id: 'basic', name: 'Basic', amount: 999, interval: 'month', currency: 'gbp', trial_period_days: 5)
CreatePlan.call(stripe_id: 'standard', name: 'Standard', amount: 2999, interval: 'month', currency: 'gbp', trial_period_days: 5)
CreatePlan.call(stripe_id: 'pro', name: 'Pro', amount: 9999, interval: 'month', currency: 'gbp', trial_period_days: 5)
```

Running 

```
rake db:seed
```

shall create the plans in Stripe. You can verify that this was successful by logging in your Stripe account:

<img src="/img/posts/stripe_plans.png"/>

<h2>5. Creating Subscription services</h2>

In this tutorial we'll encapsulate the subscription workflow in two services - one creating the Stripe subscription and another creating the corresponding subscription in our database. The latter shall occur only if the former was successful. This is marked difference to some other Stripe SaaS tutorials, most notably [the one by Pete Keen](https://www.masteringmodernpayments.com) and [the one by Daniel Kehoe](https://github.com/RailsApps/rails-stripe-membership-saas) (which is to a large extent based on Pete's). In the mentioned tutorials the creation of subscription in our database occurs even if creating the Stripe subscription fails (e.g. by providing invalid credit card details). This, in my opionion, is a serious flaw. None of these tutorials claim that their code is of production-level quality but I find it wrong to have such shortcoming even in an introductory tutorial as such code snippets tend to eventually propagate in production systems created by inexperienced or inobservant users.

Here is the code for the service creating the Stripe subscription:

```
#app/services/create_stripe_subscription.rb
class CreateStripeSubscription
  def self.call(plan, email_address, token)

    Rails.logger.info "CreateStripeSubscription: email = " + email_address + ", plan.stripe_id = " + plan.stripe_id
    stripe_sub = nil
    customer = nil

    begin
      stripe_customers = Stripe::Customer.all

      stripe_customers.each do |row|
        if row.email == email_address
          customer = Stripe::Customer.retrieve(row.id)
        end
      end

      if customer.nil?
        Rails.logger.info "CreateStripeSubscription: Stripe Customer does NOT exist"
        customer = Stripe::Customer.create(
            source: token,
            email: email_address,
            plan: plan.stripe_id,
        )
        stripe_sub = customer.subscriptions.first
        Rails.logger.info "CreateStripeSubscription: Stripe User ID = " + customer.id.to_s + ", Stripe Subscr ID = " + customer.subscriptions.first.id.to_s
      else
        Rails.logger.info "CreateStripeSubscription: Stripe Customer exists"
        stripe_sub = customer.subscriptions.create(
            plan: plan.stripe_id
        )
        Rails.logger.info "CreateStripeSubscription: Stripe User ID = " + customer.id.to_s + ", Stripe Subscr ID = " + customer.subscriptions.first.id.to_s
      end

    rescue Stripe::StripeError => e
      Rails.logger.error "CreateStripeSubscription failed: " + e.message
      if !stripe_sub.nil?
        stripe_sub.errors[:base] << e.message
      end
    end

    stripe_sub
  end
end
```

And here is the code for creating the subsequent subscription in our application database:

```
#app/services/create_subscription.rb
class CreateSubscription

  def self.call(plan, email_address, token)

    #Create Stripe Subscription
    stripe_sub = CreateStripeSubscription.call(
        plan,
        email_address,
        token
    )

    if !stripe_sub.nil?

      #Look for an user with this email. If not exists - create.
      user = User.find_by_email(email_address)
      if user.nil?
        Rails.logger.info "CreateSubscription: User is nil!"
        generated_password = Devise.friendly_token.first(8)
        user = User.new(:email => email_address, :password => generated_password, :password_confirmation => generated_password, :stripe_customer_id => stripe_sub.customer)
        if user.valid?
          Rails.logger.info "CreateSubscription: User is valid!"
        end
        user_saved = user.save
        if !user_saved
          Rails.logger.error "CreateSubscription: User not saved!"
          user.errors.each do |attribute, message|
            Rails.logger.error "  CreateSubscription: user.error = " + message
          end
        else
          Rails.logger.info "CreateSubscription: User saved"
        end
      else
        #TODO: This is a case of someone registering repeatedly (or a past user?). Need to think more on what to do.
        Rails.logger.info "CreateSubscription: User existed!"
      end

      if !user.nil? && !user.errors.any?
        #Create a new Subscription
        Rails.logger.info "CreateSubscription: user.email = " + user.email
        subscription = Subscription.new(
            plan: plan,
            user: user
        )
        subscription.stripe_id = stripe_sub.id
        subscription.save!
        Rails.logger.info "CreateSubscription: Subscription saved"
      else
        Rails.logger.info "CreateSubscription: Conditions not met to save Subscription"
      end
    else
      #Flash Message to be handled in controller
    end
    generated_password
  end
end
```
As you can see, the latter service calls the former and proceeds depending on its outcome.

<h2>6. Changing the controllers</h2>

In Step 3 above we added attribute to the User model which stores the reference to the customer ID as set in Stripe. The strong parameters in Rails 4 make it necessary to "whitelist" this attribute if we want to set it via mass assignment at the registration. The following change in the application controller accoomplishes this task:

```
#app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  # Prevent CSRF attacks by raising an exception.
  # For APIs, you may want to use :null_session instead.
  protect_from_forgery with: :exception
  before_action :configure_devise_permitted_parameters, if: :devise_controller?

  protected

  def configure_devise_permitted_parameters
    registration_params = [:email, :password, :password_confirmation]

    if params[:action] == 'update'
      devise_parameter_sanitizer.for(:account_update) {
          |u| u.permit(registration_params) # stripe_customer_id should not be updateable
      }
    elsif params[:action] == 'create'
      devise_parameter_sanitizer.for(:sign_up) {
          |u| u.permit(registration_params << :stripe_customer_id)
      }
    end
  end
end
```
The relevant line is 

`|u| u.permit(registration_params << :stripe_customer_id)`

in the "create" action. We are adding the stripe_customer_id to the "white list".

The other controller we need to change is the Devise registrations controller:

```
#app/controllers/registrations_controller.rb
class RegistrationsController < Devise::RegistrationsController
  before_filter :load_plans

  def new
    @subscription = Subscription.new
    super
  end

  def edit
    super
  end

  def destroy
    super
  end

  def cancel
    super
  end


  # POST /resource
  def create
    build_resource(sign_up_params)

    generated_password = CreateSubscription.call(
        @plan,
        params[:email_address],
        params[:stripeToken]
    )

    #resource_saved = resource.save
    if !generated_password.nil?
      user = User.find_by_email(params[:email_address])
      if !user.nil?
        resource_saved = true
        resource = user
      else
        Rails.logger.error "RegistrationsController#create user is nil!"
      end
      MyMailer.welcome(resource, generated_password, {plan: @plan}).deliver_now if resource_saved
    else
      Rails.logger.error "RegistrationsController#create failed to register with Stripe!"
      flash[:error] = "Could not register: either card details wrong or no connection to server"
    end

    yield resource if block_given?
    if resource_saved
      if resource.active_for_authentication?
        set_flash_message :notice, :signed_up if is_flashing_format?
        sign_up(resource_name, resource)
        respond_with resource, location: after_sign_up_path_for(resource)
      else
        set_flash_message :notice, :"signed_up_but_#{resource.inactive_message}" if is_flashing_format?
        expire_data_after_sign_in!
        respond_with resource, location: after_inactive_sign_up_path_for(resource)
      end
    else
      clean_up_passwords resource
      @validatable = devise_mapping.validatable?
      if @validatable
        @minimum_password_length = resource_class.password_length.min
      end
      respond_with resource
    end
  end
  def update
    super
  end

  protected

  def load_plans
    @plans = Plan.all
    @plans.each do |row|
      Rails.logger.info "RegistrationsController#load_plans: Looping through the Plans.."
      Rails.logger.info row.inspect
    end

    @plan = Plan.find(params[:plan_id])
    if @plan.nil?
      Rails.logger.error "RegistrationsController#load_plans: plan is nil!"
    else
      Rails.logger.info "RegistrationsController#load_plans: plan is NOT nil!"
    end

  end
end
```
As you can see, we override the create action to call the subscription service and proceed depending on its outcome.

<h2>6. Changing the views</h2>

First, we need to add an information on the plans available for subscription. We do this in the index view of the visitor controller:

```
<% if user_signed_in? %>
<% else %>
    <div id="welcome" class="span7">
      <h1>Stripe SaaS Tutorial</h1>
      <h3>Learn how to build a subscription site</h3>
    </div>
    <div class="row col-sm-12 plans">
      <div class="col-sm-2 well">
        <div class="plan"><h2>Basic</h2></div>
        <ul class="list-unstyled">
          <li>One unit a month</li>
        </ul>
        <h3>£9.99/month</h3>
        <%= link_to 'Subscribe', new_user_registration_path(plan_id: 1), :class => 'btn btn-primary' %>
      </div>
      <div class="col-sm-2 well featured">
        <div class="plan featured-plan"><h2>Standard</h2></div>
        <ul class="list-unstyled">
          <li>Ten units a month</li>
        </ul>
        <h3>£29.99/month</h3>
        <%= link_to 'Subscribe', new_user_registration_path(plan_id: 2), :class => 'btn btn-primary' %>
      </div>
      <div class="col-sm-2 well">
        <div class="plan"><h2>Pro</h2></div>
        <ul class="list-unstyled">
          <li>Thirty units a month</li>
        </ul>
        <h3>£99.99/month</h3>
        <%= link_to 'Subscribe', new_user_registration_path(plan_id: 3), :class => 'btn btn-primary' %>
      </div>
    </div>
<% end %>
```
Thus, the starting page of our application would look like this:

<img src="/img/posts/start_page.png"/>

The next change is to the registration view which collects the credit card info:

```
<div class="authform">
  <h3>Subscribing to <%= @plan.name %></h3>
  <%= form_for(resource, :as => resource_name, :url => registration_path(resource_name), :html => { :role => 'form'}) do |f| %>
  <input type="hidden" name="plan_id" value="<%= @plan.id %>" />
  <span class="payment-errors"></span>
  <div class="form-row">
  <label>
    <span>Email Address</span>
    <input type="email" size="20" name="email_address"/>
  </label>
  </div>

  <div class="form-row">
  <label>
    <span>Card Number</span>
    <input type="text" size="20" data-stripe="number"/>
  </label>
  </div>

  <div class="form-row">
  <label>
    <span>CVC</span>
    <input type="text" size="4" data-stripe="cvc"/>
  </label>
  </div>
  
  <div class="form-row">
  <label>
    <span>Expiration (MM/YYYY)</span>
    <input type="text" size="2" data-stripe="exp-month"/>
  </label>
  <span> / </span>
  <input type="text" size="4" data-stripe="exp-year"/>
  </div>
  
  <button type="submit">Pay Now</button>
  <% end %>
</div>
``` 
It would look like this:

<img src="/img/posts/ccard.png"/>

We will also change the mailer view so that the user gets info on both password he was assigned (as I have specifically focused in this and previous tutorial on password-less registration) and the plan he has chosen:

```
<p>Welcome to Our Application!</p>

<p>You have signed up for the <%= @plan.name %> plan.</p>

<p>We've generated a password for you: <%= @token %></p>

<p>If you prefer you can change it (under "Account/Settings").</p>
```

That's it. Now you can test. Stripe has a list of credit card numbers to test specific test scenarios. The number `4242 4242 4242 4242` always succeeds - you can test with it but make sure to set the date of validity of the credit card in the future.

Voila!

<h2>7. Further info and credits</h2>

The best accompanying source to this tutorial is the corresponding [git repository](https://github.com/nikolay12/new_devise). The current commit is [427de90f1055895ded68f1f5e3c587334f64730b](https://github.com/nikolay12/new_devise/tree/427de90f1055895ded68f1f5e3c587334f64730b). 

I've learned a lot from Pete Keen's ["Mastering Modern Payments"](masteringmodernpayments.com) and from Daniel's Kehoe [Rails SaaS example](https://github.com/RailsApps/rails-stripe-membership-saas) (the above git repository is a fork of a Stripe-unrelated git repository of him). But, of course, most instructive was playing with Stripe's [excellent API](https://stripe.com/docs/api). 