$(function(){
  $(".contato-icon").hover(function(event){
    var atual = $(this).attr("data-status");
      if(atual == 1){
        $("#label-contato").html("Follow me on Twitter!");
      }else if(atual ==2){
        $("#label-contato").html("Add me on Linkedin!");
      }else if (atual == 3){
        $("#label-contato").html("Follow me on Instagram!");
      }else{
        $("#label-contato").html("Follow me on GitHub!");
      }
    }, function(){
        $("#label-contato").html("")
    })
})
